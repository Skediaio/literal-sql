# LiteralSQL 

A lightweight, raw SQL query builder that prioritizes SQL development through template literals, rather than abstracting SQL behind programming language constructs like traditional query builders.

## Features

- Simple, intuitive API using JavaScript template literals
- SQL-focused development experience
- Automatic parameter handling to prevent SQL injection (in the JS API, not the CLI)
- Immutable query objects for safe, chainable modifications
- Clean, formatted SQL output
- Command-line interface for quickly mocking up queries and modifying existing SQL files
- Zero dependencies

## What It's Not

- **Not an ORM**: This library doesn't handle database connections or execute queries for you
- **Not a query executor**: You need to pass the generated SQL and parameters to your database client yourself
- **Not an abstraction layer**: It intentionally exposes raw SQL rather than hiding it behind methods
- **Not a schema manager**: There are no migrations or schema definitions included

## Installation

### SQLRaw - Write SQL like SQL should be written

Import directly in your code for each runtime:

# Deno
```js
import { sql } from "jsr:@skedia/literal-sql";
```

# Node.js
```sh
npx jsr add @skedia/literal-sql
```

# Bun
```sh
bunx jsr add @skedia/literal-sql
```

## Usage

```ts
import { sql } from "@skedia/literal-sql";

// Build a basic query
const query = sql`
  SELECT 
    id, 
    name, 
    email 
  FROM users
  WHERE id = ${userId}
`;

console.log(query.toString());
// SELECT
//   id,
//   name,
//   email
// FROM users
// WHERE id = :p0

console.log(query.parameters);
// { p0: 123 }

// Use with a PostgreSQL client (example with postgres.js)
const result = await client.queryObject({
  text: query.toString(),
  args: query.parameters,
});
```

## Motivation

### The Problem with Traditional Query Builders

Most query builders like Knex and Kysely focus on abstracting SQL into JavaScript/TypeScript method chains:

```ts
// Knex example
knex('users')
  .select('id', 'name', 'email')
  .where('active', true)
  .andWhere('created_at', '>', '2023-01-01')
  .orderBy('last_login', 'desc')
  .limit(10);

// Kysely example
db.selectFrom('users')
  .select(['id', 'name', 'email'])
  .where('active', '=', true)
  .where('created_at', '>', '2023-01-01')
  .orderBy('last_login', 'desc')
  .limit(10);
```

While these provide type safety, they come with drawbacks:
- You have to learn the query builder's API instead of using your SQL knowledge
- Complex queries often require awkward workarounds
- You frequently end up writing raw SQL for advanced features anyway
- Debugging means translating from builder syntax back to SQL

### The Problem with Raw SQL Strings

On the other hand, raw SQL strings have their own issues:

```ts
// Raw SQL approach
const query = `
  SELECT id, name, email 
  FROM users 
  WHERE active = true
  ${filterByDate ? "AND created_at > '2023-01-01'" : ""}
  ${sortField ? `ORDER BY ${sortField} ${sortDirection}` : ""}
  ${limit ? `LIMIT ${limit}` : ""}
`;
```

This leads to:
- String concatenation that's error-prone and unsafe
- Manual parameter handling to prevent SQL injection
- Messy conditionals that break SQL formatting
- No type safety for parameters

### Our Solution

This library gives you the best of both worlds:
- Write real SQL directly using template literals
- Get automatic parameter handling for safety
- Build queries incrementally with clean conditionals
- Keep your SQL formatted and readable
- No need to learn a new API if you already know SQL
- Store your SQL in sql files and just read them and add some conditional statements

It's ideal for developers who:
- Prefer working directly with SQL syntax
- Need to build complex queries programmatically
- Want clean, readable code without string concatenation
- Are tired of fighting with query builder limitations

### Building queries incrementally

Queries can be built incrementally by chaining `.sql` method calls:

```ts
let query = sql`SELECT * FROM users`;

// Conditionally add clauses
if (name) {
  query = query.sql`WHERE name = ${name}`;
}

if (orderByCreated) {
  query = query.sql`ORDER BY created_at DESC`;
}

if (limit) {
  query = query.sql`LIMIT ${limit}`;
}

console.log(query.toString());
console.log(query.parameters);
```

### Immutability

All operations return a new query object, preserving the original:

```ts
const baseQuery = sql`SELECT * FROM users`;
const filteredQuery = baseQuery.sql`WHERE active = ${true}`;

console.log(baseQuery.toString());    // Still just "SELECT * FROM users"
console.log(filteredQuery.toString()); // "SELECT * FROM users WHERE active = :p0"
```

## Command Line Interface

The package includes a CLI for quickly mocking up queries or modifying existing SQL files. This is useful when you have a large SQL query file and need to add conditions or clauses for testing purposes.

### Running the CLI

```sh
# Using deno task
deno task cli --query "SELECT * FROM users" --where "active = true" --limit 10

# Direct execution
deno run --allow-read jsr:@skedia/literal-sql/cli --query "SELECT * FROM users" --where "active = true"

# From a local installation
deno run --allow-read bin/cli.ts --help
```

### CLI Options

```
OPTIONS:
  -f, --file FILE       Read base SQL query from FILE
  -q, --query QUERY     Specify SQL query directly
  --where CONDITION     Add a WHERE clause
  --and CONDITION       Add an AND condition to the WHERE clause
  --or CONDITION        Add an OR condition to the WHERE clause
  --join TEXT           Add a JOIN clause
  --left-join TEXT      Add a LEFT JOIN clause
  --right-join TEXT     Add a RIGHT JOIN clause
  --inner-join TEXT     Add an INNER JOIN clause
  --group-by EXPR       Add a GROUP BY clause
  --order-by EXPR       Add an ORDER BY clause
  --limit NUMBER        Add a LIMIT clause
  --offset NUMBER       Add an OFFSET clause
  -h, --help            Show this help message
```

### CLI Examples

Build a query from a file:
```sh
deno run --allow-read bin/cli.ts --file query.sql --where "active = true" --and "created_at > '2023-01-01'"
```

Build a query from scratch:
```sh
deno run --allow-read bin/cli.ts --query "SELECT * FROM users" --where "id > 100" --order-by "created_at DESC" --limit 10
```

## License

MIT
