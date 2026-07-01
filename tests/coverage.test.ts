/**
 * Exhaustive coverage matrix for the literal-sql query builder.
 *
 * Complements sql.test.ts by systematically covering every clause variant,
 * value type, nesting shape, passthrough statement, and injection channel.
 * Expected strings were verified against real output before being pinned.
 */
import { sql } from "../mod.ts";
import { assertEquals, assertThrows } from "jsr:@std/assert";

// =========================================================================
// SELECT variants
// =========================================================================

Deno.test("SELECT DISTINCT is preserved in the field list", () => {
  const query = sql`SELECT DISTINCT dept FROM employees`;
  assertEquals(
    query.toString(),
    ["SELECT", "  DISTINCT dept", "FROM", "  employees"].join("\n"),
  );
});

Deno.test("SELECT of a bare literal (no FROM)", () => {
  const query = sql`SELECT 1`;
  assertEquals(query.toString(), ["SELECT", "  1"].join("\n"));
  assertEquals(query.parameters, []);
});

Deno.test("SELECT with table-qualified star", () => {
  const query =
    sql`SELECT u.*, o.id FROM users u JOIN orders o ON o.user_id = u.id`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  u.*,",
      "  o.id",
      "FROM",
      "  users u",
      "JOIN",
      "  orders o ON o.user_id = u.id",
    ].join("\n"),
  );
});

Deno.test("Lowercase keywords are recognised", () => {
  const query =
    sql`select id from users where active = true order by id limit 3 offset 1`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  id",
      "FROM",
      "  users",
      "WHERE",
      "  active = true",
      "ORDER BY",
      "  id",
      "LIMIT 3",
      "OFFSET 1",
    ].join("\n"),
  );
});

Deno.test("Mixed-case keywords are recognised", () => {
  const query = sql`SeLeCt id FrOm users WhErE id = ${1}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  id", "FROM", "  users", "WHERE", "  id = $1"].join("\n"),
  );
  assertEquals(query.parameters, [1]);
});

Deno.test("Schema-qualified table names", () => {
  const query = sql`SELECT * FROM public.users WHERE id = ${1}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  public.users", "WHERE", "  id = $1"].join(
      "\n",
    ),
  );
});

Deno.test("FROM with AS alias", () => {
  const query = sql`SELECT * FROM users AS u WHERE u.id = ${2}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  users AS u", "WHERE", "  u.id = $1"].join(
      "\n",
    ),
  );
  assertEquals(query.parameters, [2]);
});

Deno.test("Window function alongside a parameterised field", () => {
  const query =
    sql`SELECT ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn, salary + ${100} AS adj FROM emp`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn,",
      "  salary + $1 AS adj",
      "FROM",
      "  emp",
    ].join("\n"),
  );
  assertEquals(query.parameters, [100]);
});

Deno.test("Whitespace-only template behaves like the empty template", () => {
  const query = sql`   `;
  assertEquals(query.toString(), "SELECT\n  *");
  assertEquals(query.parameters, []);
});

// =========================================================================
// JOIN variants
// =========================================================================

Deno.test("FULL OUTER JOIN in initial query", () => {
  const query = sql`SELECT * FROM a FULL OUTER JOIN b ON a.id = b.id`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  a",
      "FULL OUTER JOIN",
      "  b ON a.id = b.id",
    ].join("\n"),
  );
});

Deno.test("FULL JOIN in initial query", () => {
  const query = sql`SELECT * FROM a FULL JOIN b ON a.id = b.id`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  a", "FULL JOIN", "  b ON a.id = b.id"].join(
      "\n",
    ),
  );
});

Deno.test("NATURAL JOIN in initial query", () => {
  const query = sql`SELECT * FROM a NATURAL JOIN b`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  a", "NATURAL JOIN", "  b"].join("\n"),
  );
});

Deno.test("NATURAL LEFT JOIN appended via .sql", () => {
  const query = sql`SELECT * FROM a`.sql`NATURAL LEFT JOIN b`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  a", "NATURAL LEFT JOIN", "  b"].join("\n"),
  );
});

Deno.test("RIGHT JOIN appended via .sql", () => {
  const query = sql`SELECT * FROM a`.sql`RIGHT JOIN b ON a.id = b.id`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  a", "RIGHT JOIN", "  b ON a.id = b.id"].join(
      "\n",
    ),
  );
});

Deno.test("JOIN with OR in the ON clause", () => {
  const query = sql`SELECT * FROM a JOIN b ON a.id = b.id OR a.alt = b.id`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  a",
      "JOIN",
      "  b ON a.id = b.id",
      "  OR a.alt = b.id",
    ].join("\n"),
  );
});

// =========================================================================
// WHERE operator zoo
// =========================================================================

Deno.test("WHERE with literal IN list keeps commas intact", () => {
  const query = sql`SELECT * FROM t WHERE id IN (1, 2, 3) AND x = ${5}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  id IN (1, 2, 3)",
      "AND",
      "  x = $1",
    ].join("\n"),
  );
  assertEquals(query.parameters, [5]);
});

Deno.test("WHERE NOT IN with parameterised values", () => {
  const query = sql`SELECT * FROM t WHERE status NOT IN (${"a"}, ${"b"})`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  status NOT IN ($1, $2)"].join(
      "\n",
    ),
  );
  assertEquals(query.parameters, ["a", "b"]);
});

Deno.test("WHERE with LIKE and ILIKE parameters", () => {
  const query =
    sql`SELECT * FROM t WHERE name LIKE ${"%x%"} OR name ILIKE ${"y%"}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  name LIKE $1",
      "OR",
      "  name ILIKE $2",
    ].join("\n"),
  );
  assertEquals(query.parameters, ["%x%", "y%"]);
});

Deno.test("WHERE with IS NULL and IS NOT NULL", () => {
  const query =
    sql`SELECT * FROM t WHERE deleted_at IS NULL AND parent_id IS NOT NULL`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  deleted_at IS NULL",
      "AND",
      "  parent_id IS NOT NULL",
    ].join("\n"),
  );
});

Deno.test("BETWEEN with parameters is not split at its AND", () => {
  const query =
    sql`SELECT * FROM t WHERE created BETWEEN ${"2024-01-01"} AND ${"2024-12-31"} AND active = true`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  created BETWEEN $1 AND $2",
      "AND",
      "  active = true",
    ].join("\n"),
  );
  assertEquals(query.parameters, ["2024-01-01", "2024-12-31"]);
});

Deno.test("NOT BETWEEN is not split at its AND", () => {
  const query =
    sql`SELECT * FROM t WHERE age NOT BETWEEN 10 AND 20 OR vip = true`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  age NOT BETWEEN 10 AND 20",
      "OR",
      "  vip = true",
    ].join("\n"),
  );
});

Deno.test("EXISTS subquery stays one condition", () => {
  const query =
    sql`SELECT * FROM t WHERE EXISTS (SELECT 1 FROM u WHERE u.t_id = t.id) AND t.ok = ${true}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  EXISTS (SELECT 1 FROM u WHERE u.t_id = t.id)",
      "AND",
      "  t.ok = $1",
    ].join("\n"),
  );
  assertEquals(query.parameters, [true]);
});

Deno.test("Deeply nested parentheses stay grouped", () => {
  const query =
    sql`SELECT * FROM t WHERE (a = 1 AND (b = 2 OR c = 3)) OR d = ${4}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  (a = 1 AND (b = 2 OR c = 3))",
      "OR",
      "  d = $1",
    ].join("\n"),
  );
});

Deno.test("Appending WHERE when one exists ANDs the condition", () => {
  const query = sql`SELECT * FROM t WHERE a = 1`.sql`WHERE b = 2`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  a = 1", "AND", "  b = 2"]
      .join("\n"),
  );
});

Deno.test("Appending OR with a parenthesised group", () => {
  const query = sql`SELECT * FROM t WHERE a = 1`.sql`OR (b = 2 AND c = 3)`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  a = 1",
      "OR",
      "  (b = 2 AND c = 3)",
    ].join("\n"),
  );
});

// =========================================================================
// Value types
// =========================================================================

Deno.test("Every value type becomes a parameter (float, empty string, boolean, Date, array, object)", () => {
  const d = new Date("2026-01-01T00:00:00Z");
  const query =
    sql`SELECT * FROM t WHERE f = ${1.5} AND s = ${""} AND b = ${false} AND d = ${d} AND arr = ${[
      1,
      2,
    ]} AND obj = ${{ a: 1 }}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  f = $1",
      "AND",
      "  s = $2",
      "AND",
      "  b = $3",
      "AND",
      "  d = $4",
      "AND",
      "  arr = $5",
      "AND",
      "  obj = $6",
    ].join("\n"),
  );
  assertEquals(query.parameters, [1.5, "", false, d, [1, 2], { a: 1 }]);
});

Deno.test("undefined interpolated in an appended fragment becomes NULL literal", () => {
  const query = sql`SELECT * FROM t WHERE a = ${1}`.sql`AND b = ${undefined}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  a = $1", "AND", "  b = NULL"]
      .join("\n"),
  );
  assertEquals(query.parameters, [1]);
});

// =========================================================================
// Nesting matrix
// =========================================================================

Deno.test("Fragment with no parameters inlines cleanly", () => {
  const query =
    sql`SELECT * FROM t WHERE ${sql`deleted_at IS NULL`} AND a = ${1}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  deleted_at IS NULL",
      "AND",
      "  a = $1",
    ].join("\n"),
  );
  assertEquals(query.parameters, [1]);
});

Deno.test("Two fragments in one template renumber sequentially", () => {
  const query =
    sql`SELECT * FROM t WHERE ${sql`a = ${1}`} AND ${sql`b = ${2} AND c = ${3}`}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  a = $1",
      "AND",
      "  b = $2",
      "AND",
      "  c = $3",
    ].join("\n"),
  );
  assertEquals(query.parameters, [1, 2, 3]);
});

Deno.test("Plain value after a multi-parameter fragment continues numbering", () => {
  const query =
    sql`SELECT * FROM t WHERE a = ${1} AND ${sql`b = ${2} AND c = ${3}`} AND z = ${9}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  a = $1",
      "AND",
      "  b = $2",
      "AND",
      "  c = $3",
      "AND",
      "  z = $4",
    ].join("\n"),
  );
  assertEquals(query.parameters, [1, 2, 3, 9]);
});

Deno.test("Fragment nested inside another fragment (two levels)", () => {
  const inner = sql`c = ${3}`;
  const mid = sql`b = ${2} AND ${inner}`;
  const query = sql`SELECT * FROM t WHERE a = ${1} AND ${mid}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  a = $1",
      "AND",
      "  b = $2",
      "AND",
      "  c = $3",
    ].join("\n"),
  );
  assertEquals(query.parameters, [1, 2, 3]);
});

Deno.test("Same fragment object used twice duplicates its parameters", () => {
  const f = sql`x > ${10}`;
  const query = sql`SELECT * FROM t WHERE ${f} AND ${f}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  x > $1", "AND", "  x > $2"]
      .join("\n"),
  );
  assertEquals(query.parameters, [10, 10]);
});

Deno.test("Nesting a chained query inlines its multi-line raw text", () => {
  let sub = sql`SELECT id FROM orders WHERE total > ${100}`;
  sub = sub.sql`AND status = ${"paid"}`;
  const query = sql`SELECT * FROM users WHERE id IN (${sub})`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  users",
      "WHERE",
      "  id IN (SELECT id FROM orders WHERE total > $1",
      "AND status = $2)",
    ].join("\n"),
  );
  assertEquals(query.parameters, [100, "paid"]);
});

Deno.test("CTE nested as a subquery is inlined into a formatted outer query", () => {
  const query =
    sql`SELECT * FROM t WHERE id IN (${sql`WITH x AS (SELECT 1 AS id) SELECT id FROM x`}) AND a = ${1}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  id IN (WITH x AS (SELECT 1 AS id) SELECT id FROM x)",
      "AND",
      "  a = $1",
    ].join("\n"),
  );
  assertEquals(query.parameters, [1]);
});

Deno.test("Nesting a UNION fragment makes the outer query raw passthrough", () => {
  // The outer query now contains a top-level-visible UNION keyword, so it is
  // preserved verbatim rather than risk misformatting.
  const query =
    sql`SELECT * FROM t WHERE id IN (${sql`SELECT id FROM a UNION SELECT id FROM b`})`;
  assertEquals(
    query.toString(),
    "SELECT * FROM t WHERE id IN (SELECT id FROM a UNION SELECT id FROM b)",
  );
});

// =========================================================================
// Passthrough zoo
// =========================================================================

Deno.test("Lowercase insert passes through raw", () => {
  const query = sql`insert into t (a) values (${1})`;
  assertEquals(query.toString(), "insert into t (a) values ($1)");
  assertEquals(query.parameters, [1]);
});

Deno.test("WITH RECURSIVE passes through raw", () => {
  const query =
    sql`WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r WHERE n < ${10}`;
  assertEquals(
    query.toString(),
    "WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r WHERE n < $1",
  );
  assertEquals(query.parameters, [10]);
});

Deno.test("UNION ALL passes through raw with parameters lifted", () => {
  const query = sql`SELECT id FROM a UNION ALL SELECT id FROM b WHERE x = ${1}`;
  assertEquals(
    query.toString(),
    "SELECT id FROM a UNION ALL SELECT id FROM b WHERE x = $1",
  );
  assertEquals(query.parameters, [1]);
});

Deno.test("INTERSECT passes through raw", () => {
  const query = sql`SELECT id FROM a INTERSECT SELECT id FROM b`;
  assertEquals(query.toString(), "SELECT id FROM a INTERSECT SELECT id FROM b");
});

Deno.test("EXCEPT passes through raw", () => {
  const query = sql`SELECT id FROM a EXCEPT SELECT id FROM b`;
  assertEquals(query.toString(), "SELECT id FROM a EXCEPT SELECT id FROM b");
});

Deno.test("'UNION' inside a string literal does NOT trigger passthrough", () => {
  const query = sql`SELECT * FROM t WHERE tag = 'UNION' AND x = ${1}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      "  tag = 'UNION'",
      "AND",
      "  x = $1",
    ].join("\n"),
  );
});

Deno.test("Identifiers containing 'union' as a substring do NOT trigger passthrough", () => {
  const query = sql`SELECT reunion, union_id FROM events WHERE reunion = ${1}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  reunion,",
      "  union_id",
      "FROM",
      "  events",
      "WHERE",
      "  reunion = $1",
    ].join("\n"),
  );
});

Deno.test("Line comment in a DML statement is stripped without trailing whitespace", () => {
  const query = sql`UPDATE t SET a = ${1} -- fix later
WHERE id = ${2}`;
  assertEquals(
    query.toString(),
    ["UPDATE t SET a = $1", "WHERE id = $2"].join("\n"),
  );
  assertEquals(query.parameters, [1, 2]);
});

// =========================================================================
// GROUP BY / ORDER BY / LIMIT variants
// =========================================================================

Deno.test("GROUP BY ordinal positions", () => {
  const query = sql`SELECT a, b, count(*) FROM t GROUP BY 1, 2`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  a,",
      "  b,",
      "  count(*)",
      "FROM",
      "  t",
      "GROUP BY",
      "  1,",
      "  2",
    ].join("\n"),
  );
});

Deno.test("ORDER BY with DESC NULLS LAST", () => {
  const query = sql`SELECT * FROM t ORDER BY updated_at DESC NULLS LAST, id`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "ORDER BY",
      "  updated_at DESC NULLS LAST,",
      "  id",
    ].join("\n"),
  );
});

Deno.test("Multiple GROUP BY / ORDER BY appends accumulate", () => {
  const query = sql`SELECT a FROM t`
    .sql`GROUP BY a`
    .sql`GROUP BY b`
    .sql`ORDER BY a`
    .sql`ORDER BY b DESC`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  a",
      "FROM",
      "  t",
      "GROUP BY",
      "  a,",
      "  b",
      "ORDER BY",
      "  a,",
      "  b DESC",
    ].join("\n"),
  );
});

Deno.test("Re-appending LIMIT replaces the previous value", () => {
  const query = sql`SELECT * FROM t LIMIT 10`.sql`LIMIT 20`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "LIMIT 20"].join("\n"),
  );
});

Deno.test("LIMIT ALL is preserved", () => {
  const query = sql`SELECT * FROM t LIMIT ALL`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "LIMIT ALL"].join("\n"),
  );
});

Deno.test("HAVING with OR in the initial query", () => {
  const query =
    sql`SELECT a, count(*) FROM t GROUP BY a HAVING count(*) > 1 OR sum(x) > ${5}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  a,",
      "  count(*)",
      "FROM",
      "  t",
      "GROUP BY",
      "  a",
      "HAVING",
      "  count(*) > 1",
      "OR",
      "  sum(x) > $1",
    ].join("\n"),
  );
  assertEquals(query.parameters, [5]);
});

// =========================================================================
// Comments and whitespace
// =========================================================================

Deno.test("Comment-only appended fragment is a no-op", () => {
  const query = sql`SELECT * FROM t WHERE a = 1`.sql`-- just a note`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  a = 1"].join("\n"),
  );
});

Deno.test("Comments at the end of every line are stripped", () => {
  const query = sql`SELECT id, -- primary key
  name -- display
FROM users -- main table
WHERE active = true -- only live`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  id,",
      "  name",
      "FROM",
      "  users",
      "WHERE",
      "  active = true",
    ].join("\n"),
  );
});

// =========================================================================
// Getters, errors, immutability
// =========================================================================

Deno.test(".query getter throws the same validation error as toString", () => {
  const query = sql`SELECT * FROM t`.sql`RETURNING id`;
  assertThrows(
    () => query.query,
    Error,
    "RETURNING clause cannot be used with SELECT statements",
  );
});

Deno.test(".parameters never throws, even when toString would", () => {
  const query = sql`SELECT * FROM t WHERE a = ${1}`.sql`RETURNING id`;
  assertEquals(query.parameters, [1]); // no throw
  assertThrows(() => query.toString(), Error);
});

Deno.test("toString is idempotent (repeated calls, same output)", () => {
  const query = sql`SELECT * FROM t WHERE a = ${1}`;
  const first = query.toString();
  assertEquals(query.toString(), first);
  assertEquals(query.toString(), first);
  assertEquals(query.parameters, [1]);
});

Deno.test("Branching one base query into two independent queries", () => {
  const base = sql`SELECT * FROM t`;
  const withWhere = base.sql`WHERE a = ${1}`;
  const withOrder = base.sql`ORDER BY b`;
  assertEquals(
    withWhere.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  a = $1"].join("\n"),
  );
  assertEquals(
    withOrder.toString(),
    ["SELECT", "  *", "FROM", "  t", "ORDER BY", "  b"].join("\n"),
  );
  assertEquals(base.toString(), ["SELECT", "  *", "FROM", "  t"].join("\n"));
  assertEquals(withWhere.parameters, [1]);
  assertEquals(withOrder.parameters, []);
});

// =========================================================================
// Injection resistance — every channel
// =========================================================================
// The security model is architectural: _interpolate lifts every ${value}
// into `params` (as a $N placeholder) BEFORE any parsing, masking, comment
// stripping, or formatting runs. A value can therefore never become SQL
// text, no matter what it contains or which clause it lands in.

const STACKED = "1; DELETE FROM users; --";
const UNION_ATTACK = "1 UNION SELECT password FROM users --";

Deno.test("Injection: stacked-query value in WHERE stays a parameter", () => {
  const query = sql`SELECT * FROM t WHERE id = ${STACKED}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  id = $1"].join("\n"),
  );
  assertEquals(query.parameters, [STACKED]);
});

Deno.test("Injection: UNION-attack value does not trigger passthrough or leak", () => {
  // The value never enters the SQL text, so the passthrough detector must
  // not see a UNION keyword — the query is formatted normally.
  const query = sql`SELECT * FROM t WHERE id = ${UNION_ATTACK}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  id = $1"].join("\n"),
  );
  assertEquals(query.parameters, [UNION_ATTACK]);
});

Deno.test("Injection: value with newline + comment survives intact as a parameter", () => {
  // Comment stripping runs on the interpolated SQL text where the value is
  // already $1 — the value itself must NOT be comment-stripped or truncated.
  const evil = "x'\n-- drop everything\nAND 1=1";
  const query = sql`SELECT * FROM t WHERE name = ${evil}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  name = $1"].join("\n"),
  );
  assertEquals(query.parameters, [evil]);
});

Deno.test("Injection: value containing the BETWEEN mask token does not corrupt splitting", () => {
  const weird = " BTWN  AND OR";
  const query = sql`SELECT * FROM t WHERE a = ${weird} AND b = ${1}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  a = $1", "AND", "  b = $2"]
      .join("\n"),
  );
  assertEquals(query.parameters, [weird, 1]);
});

Deno.test("Injection: quote-heavy value stays a parameter", () => {
  const evil = "O'Brien -- ' AND 1=1";
  const query = sql`SELECT * FROM t WHERE s = ${evil}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  s = $1"].join("\n"),
  );
  assertEquals(query.parameters, [evil]);
});

Deno.test("Injection: malicious value in LIMIT stays a parameter", () => {
  const evil = "10; DROP TABLE users";
  const query = sql`SELECT * FROM t LIMIT ${evil}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "LIMIT $1"].join("\n"),
  );
  assertEquals(query.parameters, [evil]);
});

Deno.test("Injection: malicious value in ORDER BY is parameterised (fails closed)", () => {
  // A parameter in ORDER BY orders by a constant — useless but harmless.
  // The point: the value is never concatenated into the SQL text.
  const evil = "name; DROP TABLE users";
  const query = sql`SELECT * FROM t ORDER BY ${evil}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "ORDER BY", "  $1"].join("\n"),
  );
  assertEquals(query.parameters, [evil]);
});

Deno.test("Injection: malicious value in HAVING stays a parameter", () => {
  const query =
    sql`SELECT a, count(*) FROM t GROUP BY a HAVING count(*) > ${STACKED}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  a,",
      "  count(*)",
      "FROM",
      "  t",
      "GROUP BY",
      "  a",
      "HAVING",
      "  count(*) > $1",
    ].join("\n"),
  );
  assertEquals(query.parameters, [STACKED]);
});

Deno.test("Injection: malicious value in a JOIN ON clause stays a parameter", () => {
  const query =
    sql`SELECT * FROM a JOIN b ON a.id = b.id AND b.key = ${STACKED}`;
  assertEquals(
    query.toString(),
    [
      "SELECT",
      "  *",
      "FROM",
      "  a",
      "JOIN",
      "  b ON a.id = b.id",
      "  AND b.key = $1",
    ].join("\n"),
  );
  assertEquals(query.parameters, [STACKED]);
});

Deno.test("Injection: malicious values in DML passthrough stay parameters", () => {
  const query =
    sql`DELETE FROM users WHERE name = ${STACKED} AND note = ${UNION_ATTACK}`;
  assertEquals(
    query.toString(),
    "DELETE FROM users WHERE name = $1 AND note = $2",
  );
  assertEquals(query.parameters, [STACKED, UNION_ATTACK]);
});

Deno.test("Injection: malicious value in CTE passthrough stays a parameter", () => {
  const query =
    sql`WITH x AS (SELECT id FROM t WHERE k = ${STACKED}) SELECT * FROM x`;
  assertEquals(
    query.toString(),
    "WITH x AS (SELECT id FROM t WHERE k = $1) SELECT * FROM x",
  );
  assertEquals(query.parameters, [STACKED]);
});

Deno.test("Injection: malicious value inside a nested fragment stays a parameter after renumbering", () => {
  const frag = sql`b = ${STACKED}`;
  const query = sql`SELECT * FROM t WHERE a = ${1} AND ${frag}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  a = $1", "AND", "  b = $2"]
      .join("\n"),
  );
  assertEquals(query.parameters, [1, STACKED]);
});

Deno.test("Injection: malicious value in an appended .sql fragment stays a parameter", () => {
  const query = sql`SELECT * FROM t WHERE a = 1`.sql`AND b = ${STACKED}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  a = 1", "AND", "  b = $1"]
      .join("\n"),
  );
  assertEquals(query.parameters, [STACKED]);
});

Deno.test("Injection: the string 'NULL' stays a parameter (only undefined becomes the literal)", () => {
  const query = sql`SELECT * FROM t WHERE a = ${"NULL"}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  a = $1"].join("\n"),
  );
  assertEquals(query.parameters, ["NULL"]);
});

Deno.test("Injection: array of malicious strings is one parameter", () => {
  const evil = ["'; DROP TABLE a; --", "1 OR 1=1"];
  const query = sql`SELECT * FROM t WHERE tags && ${evil}`;
  assertEquals(
    query.toString(),
    ["SELECT", "  *", "FROM", "  t", "WHERE", "  tags && $1"].join("\n"),
  );
  assertEquals(query.parameters, [evil]);
});
