# LiteralSQL

**Write SQL. Add conditionals in JavaScript. Get a query string + parameters —
pass them to any Postgres client. No DSL, no driver lock-in.**

> **Alpha.** Tested (330+ tests covering every clause variant, value type,
> nesting shape, passthrough statement, injection channel, and the CLI), but
> the public API may still change before 1.0.

## What this library believes

Three convictions drive every design decision here. If you share them,
LiteralSQL will feel obvious; if you don't, you'll be happier with Kysely or
postgres.js.

1. **SQL is the best language for writing SQL.** You should never translate a
   query in your head between a builder DSL and the SQL it produces. The query
   you write is the query that runs.
2. **JavaScript is the best language for conditionality.** `if`, `for`,
   ternaries, and variables already express "add this filter when X" better
   than any fluent API. The library's job is only the plumbing that makes that
   safe: lifting `${value}` into `$N` parameters and renumbering them as
   fragments compose.
3. **Query construction and query execution are different jobs.** LiteralSQL
   builds the string and the parameter array — it never connects, never pools,
   never owns your transaction. You keep the Postgres client you already have.

Everything else — the multi-line formatting, the CLI — is in service of
readable, debuggable SQL.

## The problem this solves

Tagged-template libraries like [postgres.js](https://github.com/porsager/postgres)
make *static* SQL beautiful:

```ts
const user = await sql`SELECT * FROM users WHERE id = ${id}`;
```

Hard to beat — for a query you know up front. The trouble starts with
**conditionals and dynamic fragments.** postgres.js handles these by overloading
a single `sql()` helper to mean different things depending on what you pass it
([their own README has a "quick primer" table for the forms](https://github.com/porsager/postgres#quick-primer-on-interpolation)):

| Interpolation | Means |
| --- | --- |
| `${ sql\`...\` }` | a SQL fragment |
| `${ sql("col") }` | an identifier (column / table name) |
| `${ sql([] \| {}, "col", ...) }` | an insert/update/value-list helper |
| `${ value }` | a plain parameter |

Four forms, one helper — and the helper form is itself overloaded (an array of
primitives becomes an `IN` list; an array of objects becomes a multi-row insert;
an object plus column names becomes a typed insert). To build a conditional
query you mix these and hope you picked the right wrap:

```ts
// postgres.js — a conditional query:
await sql`
  select ${sql(columns)}                        -- identifier form
  from users
  where age in ${sql([68, 75, 23])}             -- value-list form
  ${filterAge ? sql`and age > ${age}` : sql``}  -- fragment form + empty fragment
`
```

Get any `sql(...)` wrap wrong and the query breaks — or worse, silently does the
wrong thing. The rules are subtle enough that even AI assistants routinely emit
broken postgres.js queries. That's the friction this library exists to remove.

### One rule instead of four

LiteralSQL has a single interpolation rule: **`${value}` is always a parameter**
(and a nested `sql` fragment is always a fragment). No overloaded helper, no
identifier-vs-fragment-vs-helper decision tree. For anything that isn't a
value, you write the SQL and chain it with `.sql`:

```ts
import { sql } from "@skedia/literal-sql";

let query = sql`SELECT id, name, email FROM users WHERE 1=1`;

if (filterByName) query = query.sql`AND name = ${name}`;
if (filterByAge)  query = query.sql`AND age > ${age}`;
if (limit)        query = query.sql`LIMIT ${limit}`;
```

The SQL stays SQL. Each `${value}` is lifted to a `$N` parameter and renumbered
across the whole chain:

```sql
-- query.toString():
SELECT
  id,
  name,
  email
FROM
  users
WHERE
  1=1
AND
  name = $1
AND
  age > $2
LIMIT $3
```

```ts
query.parameters // → [name, age, limit]
```

**Honest trade-off:** postgres.js's helpers genuinely do things literal-sql
doesn't — dynamic multi-row inserts from objects (`sql(users)`), identifier
escaping, `IN`-list shorthand. If you need those, postgres.js earns its
complexity. LiteralSQL is focused on the case where the overloading hurts most:
**conditional composition of the query you're already writing by hand.**

## Composing fragments

A query can be nested inside another as a fragment. Its parameters are
renumbered past the outer query's parameters automatically:

```ts
const activeOrgs = sql`SELECT id FROM orgs WHERE active = ${true}`;

const query = sql`
  SELECT * FROM users
  WHERE role = ${role}
  AND org_id IN (${activeOrgs})
`;

query.parameters // → [role, true] — numbering handled for you
```

This also works for reusable condition fragments:

```ts
const notDeleted = sql`deleted_at IS NULL`;
let query = sql`SELECT * FROM posts WHERE author_id = ${authorId}`;
query = query.sql`AND ${notDeleted}`;
```

## SELECT queries are formatted; everything else is left as written

For plain `SELECT` queries, `toString()` emits consistently formatted,
multi-line SQL — one clause per line, terms indented, `AND`/`OR` on their own
lines — so generated queries are pleasant to read in logs and diffs.

Formatting only ever changes whitespace and keyword case. The result is
checked against what you wrote; if it would differ in any other way, you get
your text back unformatted. Quoted text is opaque in every PostgreSQL form:
`'...'`, `E'...'`, `"..."`, `$$...$$`, `$tag$...$tag$`.

Every other statement — `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `WITH`,
`UNION`, `EXPLAIN`, DDL, ... — is returned exactly as written (trimmed,
comments stripped), with `${}` values lifted to `$N` parameters.

```ts
const del = sql`DELETE FROM sessions WHERE expires_at < ${cutoff} RETURNING id`;
del.toString();  // "DELETE FROM sessions WHERE expires_at < $1 RETURNING id"
del.parameters;  // [cutoff]
```

## Appended clauses go where the statement expects them

`.sql` works on any statement, not only on `SELECT`. A clause is placed by
its position in SQL's clause order, whatever the order you append in:

```ts
let q = sql`UPDATE users SET active = ${false} RETURNING id`;
q = q.sql`WHERE last_login < ${cutoff}`;
// UPDATE users SET active = $1
// WHERE last_login < $2
// RETURNING id

let report = sql`WITH recent AS (SELECT * FROM orders WHERE day > ${since})
SELECT * FROM recent ORDER BY total DESC`;
report = report.sql`WHERE total > ${min}`.sql`LIMIT ${10}`;
// ... SELECT * FROM recent WHERE total > $2 ORDER BY total DESC LIMIT $3
```

- A second `WHERE` / `HAVING` is ANDed onto the first, with parentheses
  around any side that contains an `OR`.
- `ORDER BY`, `GROUP BY`, `SELECT` and `RETURNING` extend their list;
  `LIMIT`, `OFFSET` and `FROM` replace the previous value.
- `AND ...` / `OR ...` continue the condition written last — a `JOIN ... ON`,
  the `WHERE`, or the `HAVING`.
- A fragment that is not a clause (`SET ...`, `ON CONFLICT ...`,
  `UNION ALL SELECT ...`) is attached at the end, as written.
- If a clause could go in more than one place (for example a `WHERE` on an
  `INSERT ... ON CONFLICT ... WHERE ... DO UPDATE ... WHERE ...`), `.sql`
  throws instead of guessing.

## Other databases

`.query` uses PostgreSQL `$1, $2` placeholders. `dialect(name)` returns the
query with placeholders for another database: `"postgres"` (`$1`), `"mysql"`
and `"sqlite"` (`?`), `"mssql"` (`@p1`) or `"oracle"` (`:1`). For `?` the
parameters are listed in the order the placeholders occur, which differs from
`$N` order when a clause was spliced in front of an earlier value:

```ts
const q = sql`SELECT id, \`name\` FROM users LIMIT ${10}`
  .sql`WHERE active = ${true}`;
const { query, parameters } = q.dialect("mysql");
// SELECT
//   id,
//   `name`
// FROM
//   users
// WHERE
//   active = ?
// LIMIT ?
parameters; // [true, 10]
```

Backtick (`` `name` ``) and bracket (`[name]`) identifiers are understood.
Not handled: backslash escapes in plain `'...'` strings (MySQL default) and
MySQL `#` comments; use `--` comments and doubled quotes (`''`).

## How interpolated values are treated

| You interpolate | It becomes |
| --- | --- |
| a value (`string`, `number`, `Date`, array, object, ...) | a `$N` parameter |
| `null` | a `$N` parameter with value `null` |
| a `sql` fragment | inline SQL, parameters renumbered |
| `undefined` | the SQL literal `NULL` |

> ⚠️ **The `undefined` case is a footgun to know about:** `x = NULL` is never
> true in SQL (you need `x IS NULL`). The substitution exists so optional
> values can vanish from the parameter list, but if you meant to filter on
> null, write `IS NULL` explicitly — or pass `null`, which stays a parameter.

A hand-written placeholder (`WHERE id = $1`) only works in a query without
`${}` values; mixing both throws, since the numbers would collide. `$1` inside
quotes or comments is just text.

Because `${value}` can never become SQL text, injection through values is
architecturally impossible — the test suite locks this in with dedicated
injection-resistance tests.

## Executor-agnostic — bring your own Postgres client

LiteralSQL doesn't connect to a database, execute queries, or know anything
about your driver. It parses your SQL fragments, extracts parameters, and hands
you back a query string + params array. That's the whole job.

Pass them to whatever Postgres client you already use:

```ts
// node-postgres (pg) — the established default:
const { rows } = await pool.query(query.toString(), query.parameters);

// postgres.js (porsager's):
const rows = await sql.unsafe(query.toString(), query.parameters);
```

**No driver lock-in.** Other tagged-template libraries (postgres.js, slonik)
bind query construction to their executor — adopting them means adopting their
connection pool, their result shape, and their transaction model. LiteralSQL
keeps construction and execution separate, so:

- **Use the executor you already have.** Already on node-postgres? You don't
  need to rip out your database layer just to get template-literal queries.
- **Swap executors without rewriting queries.** Moving between `pg` and
  postgres.js is a one-line change at the call site — your query construction
  code stays put.
- **Mock the database in tests.** LiteralSQL runs with zero database. Call
  `query.toString()` and `query.parameters` to assert generated SQL in unit
  tests, no connection required.

> Postgres-placeholder specific: LiteralSQL emits `$1, $2, ...` parameters, so
> it works with any Postgres-compatible client. SQLite/MySQL clients use
> different placeholder syntax and won't work without translation.

## Immutability

Every `.sql` call returns a *new* query — the original is untouched. Safe to
share, cache, and branch without surprising mutations:

```ts
const base = sql`SELECT * FROM users`;
const filtered = base.sql`WHERE active = ${true}`;

base.toString();     // SELECT * FROM users           — unchanged
filtered.toString(); // SELECT * FROM users WHERE active = $1
// (both formatted one clause per line, as shown above)
```

## What it's not

- **Not an executor.** It builds the SQL string + parameters array; you pass
  them to your own database client. No connection pool, no driver lock-in.
- **Not an ORM.** No models, no relations, no migrations. It's a query builder.
- **Not a DSL.** You write SQL fragments. The entire API surface is a tagged
  template plus `.sql` for chaining.

## Installation

```sh
npm install @skedia/literal-sql
```

Requires Node.js 22.18+ (also works with Bun). The package is also published
on JSR (`npx jsr add @skedia/literal-sql`, or `jsr:@skedia/literal-sql` in Deno).

## Command Line Interface

The package includes a CLI for quickly mocking up queries or modifying existing
SQL files. This is useful when you have a large SQL query file and need to add
conditions or clauses for testing purposes.

### Running the CLI

```sh
# Without installing
npx @skedia/literal-sql --query "SELECT * FROM users" --where "active = true" --limit 10

# Installed in a project
npx literal-sql --help

# From a checkout of this repo
npm run cli -- --query "SELECT * FROM users" --where "active = true"
```

### CLI Options

```
OPTIONS:
  -f, --file FILE       Read base SQL query from FILE
  -q, --query QUERY     Specify SQL query directly
  --where CONDITION     Add a WHERE clause (ANDed onto an existing WHERE)
  --and CONDITION       Continue the condition written last (JOIN ... ON,
                        WHERE or HAVING) with AND; in a SELECT without
                        one, start the WHERE clause
  --or CONDITION        Like --and, with OR
  --join TEXT           Add a JOIN clause
  --left-join TEXT      Add a LEFT JOIN clause
  --right-join TEXT     Add a RIGHT JOIN clause
  --inner-join TEXT     Add an INNER JOIN clause
  --group-by EXPR       Add GROUP BY terms (extends an existing GROUP BY)
  --order-by EXPR       Add ORDER BY terms (extends an existing ORDER BY)
  --limit NUMBER        Set the LIMIT (replaces an existing one)
  --offset NUMBER       Set the OFFSET (replaces an existing one)
  -h, --help            Show this help message
```

### CLI Examples

Build a query from a file:

```sh
literal-sql --file query.sql --where "active = true" --and "created_at > '2023-01-01'"
```

Build a query from scratch:

```sh
literal-sql --query "SELECT * FROM users" --where "id > 100" --order-by "created_at DESC" --limit 10
```

## License

MIT
