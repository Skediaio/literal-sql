// Import the sql function
import { sql } from "../mod.ts";
import { assertEquals } from "jsr:@std/assert";

// Basic SELECT Tests
Deno.test("Basic SELECT query", () => {
  const query = sql`SELECT * FROM users`;
  assertEquals(query.toString(), "SELECT\n  * FROM users");
});

Deno.test("SELECT with fields", () => {
  const query = sql`SELECT id, name, email FROM users`;
  assertEquals(query.toString(), "SELECT\n  id, name, email FROM users");
});

Deno.test("SELECT with fields on multiple lines", () => {
  const query = sql`
  SELECT 
    id, 
    name, 
    email 
  FROM users`;
  assertEquals(query.toString(), "SELECT\n  id,\n  name,\n  email\nFROM users");
});

// JOIN Tests
Deno.test("SELECT with JOIN", () => {
  const query = sql`SELECT * FROM users JOIN orders ON users.id = orders.user_id`;
  assertEquals(
    query.toString(),
    "SELECT\n  * FROM users JOIN orders ON users.id = orders.user_id",
  );
});

Deno.test("SELECT with multiple JOINs", () => {
  const query = sql`
  SELECT * 
  FROM users 
  JOIN orders ON users.id = orders.user_id
  JOIN products ON orders.product_id = products.id`;
  assertEquals(
    query.toString(),
    "SELECT\n  *\nFROM users\nJOIN orders ON users.id = orders.user_id\nJOIN products ON orders.product_id = products.id",
  );
});

Deno.test("Adding a JOIN with sql method", () => {
  const query = sql`SELECT * FROM users`;
  const newQuery = query.sql`JOIN orders ON users.id = orders.user_id`;
  assertEquals(
    newQuery.toString(),
    "SELECT\n  * FROM users\nJOIN orders ON users.id = orders.user_id",
  );
  // Original query should be unchanged
  assertEquals(query.toString(), "SELECT\n  * FROM users");
});

Deno.test("Adding multiple JOINs with sql method", () => {
  let query = sql`SELECT * FROM users`;
  query = query.sql`JOIN orders ON users.id = orders.user_id`;
  query = query.sql`LEFT JOIN products ON orders.product_id = products.id`;
  assertEquals(
    query.toString(),
    "SELECT\n  * FROM users\nJOIN orders ON users.id = orders.user_id\nLEFT JOIN products ON orders.product_id = products.id",
  );
});

// WHERE Tests
Deno.test("SELECT with WHERE", () => {
  const query = sql`SELECT * FROM users WHERE id = 1`;
  assertEquals(query.toString(), "SELECT\n  * FROM users WHERE id = 1");
});

Deno.test("Adding a WHERE with sql method", () => {
  const query = sql`SELECT * FROM users`;
  const newQuery = query.sql`WHERE id = 1`;
  assertEquals(newQuery.toString(), "SELECT\n  * FROM users\nWHERE id = 1");
});

Deno.test("Adding multiple WHERE conditions with AND", () => {
  let query = sql`SELECT * FROM users`;
  query = query.sql`WHERE id = 1`;
  query = query.sql`AND name = 'John'`;
  assertEquals(
    query.toString(),
    "SELECT\n  * FROM users\nWHERE id = 1\n  AND name = 'John'",
  );
});

Deno.test("Adding multiple WHERE conditions with OR", () => {
  let query = sql`SELECT * FROM users`;
  query = query.sql`WHERE id = 1`;
  query = query.sql`OR name = 'John'`;
  assertEquals(
    query.toString(),
    "SELECT\n  * FROM users\nWHERE id = 1\n  OR name = 'John'",
  );
});

Deno.test(
  "Adding WHERE conditions without explicit operator (should default to AND)",
  () => {
    let query = sql`SELECT * FROM users`;
    query = query.sql`WHERE id = 1`;
    query = query.sql`name = 'John'`;
    assertEquals(
      query.toString(),
      "SELECT\n  * FROM users\nWHERE id = 1\n  AND name = 'John'",
    );
  },
);

// GROUP BY Tests
Deno.test("SELECT with GROUP BY", () => {
  const query = sql`SELECT count(*) FROM users GROUP BY department`;
  assertEquals(
    query.toString(),
    "SELECT\n  count(*) FROM users GROUP BY department",
  );
});

Deno.test("Adding GROUP BY with sql method", () => {
  const query = sql`SELECT count(*) FROM users`;
  const newQuery = query.sql`GROUP BY department`;
  assertEquals(
    newQuery.toString(),
    "SELECT\n  count(*) FROM users\nGROUP BY department",
  );
});

Deno.test("Multiple GROUP BY fields", () => {
  const query = sql`SELECT count(*) FROM users GROUP BY department, role`;
  assertEquals(
    query.toString(),
    "SELECT\n  count(*) FROM users GROUP BY department, role",
  );
});

// ORDER BY Tests
Deno.test("SELECT with ORDER BY", () => {
  const query = sql`SELECT * FROM users ORDER BY name`;
  assertEquals(query.toString(), "SELECT\n  * FROM users ORDER BY name");
});

Deno.test("Adding ORDER BY with sql method", () => {
  const query = sql`SELECT * FROM users`;
  const newQuery = query.sql`ORDER BY name`;
  assertEquals(newQuery.toString(), "SELECT\n  * FROM users\nORDER BY name");
});

Deno.test("ORDER BY with direction", () => {
  const query = sql`SELECT * FROM users ORDER BY name DESC`;
  assertEquals(query.toString(), "SELECT\n  * FROM users ORDER BY name DESC");
});

Deno.test("Multiple ORDER BY fields", () => {
  const query = sql`SELECT * FROM users ORDER BY department, name DESC`;
  assertEquals(
    query.toString(),
    "SELECT\n  * FROM users ORDER BY department, name DESC",
  );
});

// LIMIT and OFFSET Tests
Deno.test("SELECT with LIMIT", () => {
  const query = sql`SELECT * FROM users LIMIT 10`;
  assertEquals(query.toString(), "SELECT\n  * FROM users LIMIT 10");
});

Deno.test("Adding LIMIT with sql method", () => {
  const query = sql`SELECT * FROM users`;
  const newQuery = query.sql`LIMIT 10`;
  assertEquals(newQuery.toString(), "SELECT\n  * FROM users\nLIMIT 10");
});

Deno.test("SELECT with OFFSET", () => {
  const query = sql`SELECT * FROM users OFFSET 20`;
  assertEquals(query.toString(), "SELECT\n  * FROM users OFFSET 20");
});

Deno.test("Adding OFFSET with sql method", () => {
  const query = sql`SELECT * FROM users`;
  const newQuery = query.sql`OFFSET 20`;
  assertEquals(newQuery.toString(), "SELECT\n  * FROM users\nOFFSET 20");
});

Deno.test("LIMIT and OFFSET together", () => {
  let query = sql`SELECT * FROM users`;
  query = query.sql`LIMIT 10`;
  query = query.sql`OFFSET 20`;
  assertEquals(query.toString(), "SELECT\n  * FROM users\nLIMIT 10\nOFFSET 20");
});

// Parameter Tests
Deno.test("Parameters in WHERE clause", () => {
  const id = 1;
  const query = sql`SELECT * FROM users WHERE id = ${id}`;
  assertEquals(query.toString().includes("$1"), true);
  assertEquals(query.toString(), "SELECT\n  * FROM users WHERE id = $1");
  assertEquals(query.parameters[0], 1);
});

Deno.test("Multiple parameters", () => {
  const id = 1;
  const name = "John";
  const query = sql`SELECT * FROM users WHERE id = ${id} AND name = ${name}`;
  assertEquals(query.toString().includes("$1"), true);
  assertEquals(query.parameters[0], 1);
  assertEquals(query.parameters[1], "John");
});

Deno.test("Parameters added with sql method", () => {
  const id = 1;
  let query = sql`SELECT * FROM users`;
  query = query.sql`WHERE id = ${id}`;
  assertEquals(query.parameters[0], 1);
  assertEquals(query.toString().includes("$1"), true);
});

Deno.test("Multiple parameters across multiple sql calls", () => {
  const id = 1;
  const name = "John";
  let query = sql`SELECT * FROM users`;
  query = query.sql`WHERE id = ${id}`;
  query = query.sql`AND name = ${name}`;
  assertEquals(query.toString().includes("$1"), true);
  assertEquals(
    query.toString(),
    "SELECT\n  * FROM users\nWHERE id = $1\n  AND name = $2",
  );
  assertEquals(query.parameters[0], 1);
  assertEquals(query.parameters[1], "John");
});

Deno.test("Skip undefined values", () => {
  const id = 1;
  const name = undefined;
  let query = sql`SELECT * FROM users WHERE id = ${id} AND name = ${name}`;
  assertEquals(query.toString().includes("$1"), true);
  assertEquals(query.toString().includes("undefined"), false);
  assertEquals(
    query.toString(),
    "SELECT\n  * FROM users WHERE id = $1 AND name = NULL",
  );
  assertEquals(query.parameters[0], 1);
});

// Complex Query Tests
Deno.test("Complex query with all clauses", () => {
  const name = "John";
  const limit = 10;

  let query = sql`
  SELECT 
    id,
    name,
    email,
    created_at
  FROM users
  `;

  query = query.sql`JOIN orders ON users.id = orders.user_id`;
  query = query.sql`WHERE name LIKE ${"%" + name + "%"}`;
  query = query.sql`GROUP BY users.id`;
  query = query.sql`ORDER BY created_at DESC`;
  query = query.sql`LIMIT ${limit}`;

  const expected = [
    "SELECT",
    "  id,",
    "  name,",
    "  email,",
    "  created_at",
    "FROM users",
    "JOIN orders ON users.id = orders.user_id",
    "WHERE name LIKE $1",
    "GROUP BY users.id",
    "ORDER BY created_at DESC",
    "LIMIT $2",
  ].join("\n");

  assertEquals(query.toString().includes("$1"), true);
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters[0], "%John%");
  assertEquals(query.parameters[1], 10);
});

Deno.test("Building query conditionally", () => {
  const filters = {
    hasName: true,
    name: "John",
    hasAge: false,
    age: null,
    hasOrder: true,
    limit: 10,
  };

  let query = sql`SELECT * FROM users`;

  if (filters.hasOrder) {
    query = query.sql`JOIN orders ON users.id = orders.user_id`;
  }

  let hasWhere = false;

  if (filters.hasName) {
    query = query.sql`WHERE name = ${filters.name}`;
    hasWhere = true;
  }

  if (filters.hasAge) {
    if (hasWhere) {
      query = query.sql`AND age = ${filters.age}`;
    } else {
      query = query.sql`WHERE age = ${filters.age}`;
      hasWhere = true;
    }
  }

  if (filters.limit) {
    query = query.sql`LIMIT ${filters.limit}`;
  }

  const expected = [
    "SELECT",
    "  * FROM users",
    "JOIN orders ON users.id = orders.user_id",
    "WHERE name = $1",
    "LIMIT $2",
  ].join("\n");

  assertEquals(query.toString().includes("$1"), true);
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters[0], "John");
  assertEquals(query.parameters[1], 10);
});

// Edge case Tests
Deno.test("Empty SELECT", () => {
  const query = sql`SELECT FROM users`;
  assertEquals(query.toString(), "SELECT\n  FROM users");
});

Deno.test("SELECT with leading commas", () => {
  const query = sql`
  SELECT 
    , id
    , name
    , email
  FROM users`;
  assertEquals(query.toString(), "SELECT\n  id,\n  name,\n  email\nFROM users");
});

Deno.test("SELECT with trailing commas", () => {
  const query = sql`
  SELECT 
    id,
    name,
    email,
  FROM users`;
  assertEquals(query.toString(), "SELECT\n  id,\n  name,\n  email\nFROM users");
});

Deno.test("Query immutability", () => {
  const query1 = sql`SELECT * FROM users`;
  const query2 = query1.sql`WHERE id = 1`;

  // Original query is unchanged
  assertEquals(query1.toString(), "SELECT\n  * FROM users");
  // New query has the WHERE clause
  assertEquals(query2.toString(), "SELECT\n  * FROM users\nWHERE id = 1");
});

// Async usage pattern test
Deno.test("Async usage pattern", async () => {
  // Simulate async data fetching
  const fetchUser = async (id: number) => {
    // Pretend we're fetching from a database or API
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { id, name: "User " + id };
  };

  const id = 5;
  let query = sql`SELECT * FROM users`;

  // Fetch data asynchronously
  const user = await fetchUser(id);

  // Use the data in the query
  query = query.sql`WHERE name = ${user.name}`;

  assertEquals(query.toString().includes("$1"), true);
  assertEquals(query.toString(), "SELECT\n  * FROM users\nWHERE name = $1");
  assertEquals(query.parameters[0], "User 5");
});
