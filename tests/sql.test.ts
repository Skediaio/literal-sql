/**
 * Tests for the literal-sql query builder.
 *
 * Note: Expected strings are formatted precisely according to the desired multi-line
 * output format for enhanced readability and potentially simpler parsing by consumers.
 * Indentation uses 2 spaces. Functions are expected to format recursively.
 * JOIN, GROUP BY, HAVING, ORDER BY clauses are expected to be multi-line.
 * DML statements (INSERT, UPDATE, DELETE) and WITH/UNION/INTERSECT/EXCEPT
 * queries pass through raw: the statement text is preserved verbatim
 * (comments stripped, ${} values lifted to $N parameters) and never reformatted.
 * Multi-line expected strings are written as arrays joined by '\n' for readability.
 */

import { deepStrictEqual as assertEquals, throws } from "node:assert/strict";
import { test } from "node:test";
import { type SQLQuery, sql } from "../mod.ts"; // Assuming SQLQuery is exported if needed directly

// --- Basic SELECT Tests ---

test("Basic SELECT query", () => {
  const query = sql`SELECT * FROM users`;
  // Expected format based on toString() output.
  const expected = ["SELECT", "  *", "FROM", "  users"].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("SELECT with fields", () => {
  const query = sql`SELECT id, name, email FROM users`;
  const expected = [
    "SELECT",
    "  id,",
    "  name,",
    "  email",
    "FROM",
    "  users",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("SELECT with fields on multiple lines", () => {
  const query = sql`
  SELECT
    id,
    name,
    email
  FROM users`;
  // Parser handles multi-line select, toString formats it.
  const expected = [
    "SELECT",
    "  id,",
    "  name,",
    "  email",
    "FROM",
    "  users",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

// --- JOIN Tests ---

test("SELECT with JOIN", () => {
  const query = sql`SELECT * FROM users JOIN orders ON users.id = orders.user_id`;
  // Expected format: JOIN keyword on new line, condition indented.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "JOIN", // JOIN keyword on its own line
    "  orders ON users.id = orders.user_id", // Condition indented
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("SELECT with multiple JOINs", () => {
  const query = sql`
  SELECT *
  FROM users
  JOIN orders ON users.id = orders.user_id
  JOIN products ON orders.product_id = products.id`;
  // Expected format: Each JOIN clause starts on a new line.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "JOIN", // First JOIN keyword
    "  orders ON users.id = orders.user_id", // First JOIN condition
    "JOIN", // Second JOIN keyword
    "  products ON orders.product_id = products.id", // Second JOIN condition
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Adding a JOIN with sql method", () => {
  const query = sql`SELECT * FROM users`;
  const newQuery = query.sql`JOIN orders ON users.id = orders.user_id`;
  // Expected format: Incremental add keeps JOIN keyword separate. Condition indented.
  const expectedNew = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "JOIN", // JOIN keyword added separately
    "  orders ON users.id = orders.user_id", // Condition indented
  ].join("\n");
  assertEquals(newQuery.toString(), expectedNew);
  assertEquals(newQuery.parameters, []);

  // Original query should be unchanged
  const expectedOriginal = ["SELECT", "  *", "FROM", "  users"].join("\n");
  assertEquals(query.toString(), expectedOriginal);
});

test("JOIN with AND conditions in ON clause", () => {
  // Test JOIN clauses with multiple AND conditions in ON
  const query = sql`
  SELECT *
  FROM users
  LEFT JOIN shopping_list sl ON users.shopping_id = sl.id AND users.date < "2025-01-01"
  LEFT JOIN products p ON sl.id = p.list_id AND p.active = true`;

  // Expected format: JOIN keyword, first condition, AND keyword, second condition - all indented appropriately.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "LEFT JOIN", // First JOIN type
    "  shopping_list sl ON users.shopping_id = sl.id", // First part of ON
    '  AND users.date < "2025-01-01"', // Second part of ON (indented under JOIN)
    "LEFT JOIN", // Second JOIN type
    "  products p ON sl.id = p.list_id", // First part of second ON
    "  AND p.active = true", // Second part of second ON
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Table aliases in FROM and JOIN", () => {
  const query = sql`
  SELECT u.id, o.order_date
  FROM users u
  JOIN orders o ON u.id = o.user_id`;
  const expected = [
    "SELECT",
    "  u.id,",
    "  o.order_date",
    "FROM",
    "  users u",
    "JOIN", // JOIN keyword
    "  orders o ON u.id = o.user_id", // Condition indented
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Complex JOIN with AND/OR combinations in ON clause", () => {
  const query = sql`
  SELECT u.name, p.title
  FROM users u
  JOIN posts p ON u.id = p.user_id AND p.published = true
  LEFT JOIN comments c ON p.id = c.post_id AND (c.approved = true OR c.user_id = u.id)`;

  // Expected format: AND/OR conditions within ON clause on new lines, indented.
  const expected = [
    "SELECT",
    "  u.name,",
    "  p.title",
    "FROM",
    "  users u",
    "JOIN", // First JOIN
    "  posts p ON u.id = p.user_id", // First part of ON
    "  AND p.published = true", // Second part of ON
    "LEFT JOIN", // Second JOIN
    "  comments c ON p.id = c.post_id", // First part of second ON
    "  AND (c.approved = true OR c.user_id = u.id)", // Second part of second ON (parentheses kept together)
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Adding multiple JOINs with sql method", () => {
  let query = sql`SELECT * FROM users`;
  query = query.sql`JOIN orders ON users.id = orders.user_id`;
  query = query.sql`LEFT JOIN products ON orders.product_id = products.id`;
  // Expected format: Each incremental JOIN adds its keyword and indented condition.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "JOIN", // First added JOIN keyword
    "  orders ON users.id = orders.user_id", // First added JOIN condition
    "LEFT JOIN", // Second added JOIN keyword
    "  products ON orders.product_id = products.id", // Second added JOIN condition
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

// --- WHERE Tests ---

test("SELECT with WHERE", () => {
  const query = sql`SELECT * FROM users WHERE id = 1`;
  // Expected format: WHERE on new line, condition indented.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = 1",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Adding a WHERE with sql method", () => {
  const query = sql`SELECT * FROM users`;
  const newQuery = query.sql`WHERE id = 1`;
  // Expected format: WHERE added incrementally.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = 1",
  ].join("\n");
  assertEquals(newQuery.toString(), expected);
  assertEquals(newQuery.parameters, []);
});

test("Adding multiple WHERE conditions with AND", () => {
  let query = sql`SELECT * FROM users`;
  query = query.sql`WHERE id = 1`;
  query = query.sql`AND name = 'John'`;
  const finalExpected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = 1",
    "AND", // AND on new line
    "  name = 'John'", // Condition indented
  ].join("\n");

  assertEquals(query.toString(), finalExpected);
  assertEquals(query.parameters, []);
});

test("Adding multiple WHERE conditions with OR", () => {
  let query = sql`SELECT * FROM users`;
  query = query.sql`WHERE id = 1`;
  query = query.sql`OR name = 'John'`;
  // Expected format: OR on new line, condition indented.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = 1",
    "OR", // OR on new line
    "  name = 'John'", // Condition indented
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Adding WHERE conditions without explicit operator (defaults to AND)", () => {
  let query = sql`SELECT * FROM users`;
  query = query.sql`WHERE id = 1`;
  // This fragment doesn't start with AND/OR, parseQuery assumes AND
  query = query.sql`name = 'John'`;
  // Expected format: Default AND on new line, condition indented.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = 1",
    "AND", // Defaulted to AND on new line
    "  name = 'John'", // Condition indented
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("WHERE clause with parentheses", () => {
  const status = "active";
  const type = "admin";
  const query = sql`SELECT * FROM users WHERE status = ${status} AND (type = ${type} OR is_superuser = true)`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  status = $1", // First part
    "AND", // AND on new line
    "  (type = $2 OR is_superuser = true)", // Parenthesized part indented
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [status, type]);
});

// --- GROUP BY Tests ---

test("SELECT with GROUP BY", () => {
  const query = sql`SELECT department, count(*) FROM users GROUP BY department`;
  // Expected format: GROUP BY on new line, terms indented on subsequent lines.
  const expected = [
    "SELECT",
    "  department,",
    "  count(*)",
    "FROM",
    "  users",
    "GROUP BY",
    "  department", // Only one term
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Adding GROUP BY with sql method", () => {
  const query = sql`SELECT count(*) FROM users`;
  const newQuery = query.sql`GROUP BY department`;
  // Expected format: GROUP BY added incrementally.
  const expected = [
    "SELECT",
    "  count(*)",
    "FROM",
    "  users",
    "GROUP BY", // Added GROUP BY keyword
    "  department", // Added term indented
  ].join("\n");
  assertEquals(newQuery.toString(), expected);
  assertEquals(newQuery.parameters, []);
});

test("Multiple GROUP BY fields", () => {
  const query = sql`SELECT department, role, count(*) FROM users GROUP BY department, role`;
  // Expected format: GROUP BY on new line, each term indented on subsequent lines, comma-terminated.
  const expected = [
    "SELECT",
    "  department,",
    "  role,",
    "  count(*)",
    "FROM",
    "  users",
    "GROUP BY",
    "  department,", // First term
    "  role", // Second term
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

// --- ORDER BY Tests ---

test("SELECT with ORDER BY", () => {
  const query = sql`SELECT * FROM users ORDER BY name`;
  // Expected format: ORDER BY on new line, term indented.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "ORDER BY",
    "  name",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Adding ORDER BY with sql method", () => {
  const query = sql`SELECT * FROM users`;
  const newQuery = query.sql`ORDER BY name`;
  // Expected format: ORDER BY added incrementally.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "ORDER BY", // Added ORDER BY keyword
    "  name", // Added term indented
  ].join("\n");
  assertEquals(newQuery.toString(), expected);
  assertEquals(newQuery.parameters, []);
});

test("ORDER BY with direction", () => {
  const query = sql`SELECT * FROM users ORDER BY name DESC`;
  // Expected format: ORDER BY on new line, term with direction indented.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "ORDER BY",
    "  name DESC",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Multiple ORDER BY fields", () => {
  const query = sql`SELECT * FROM users ORDER BY department ASC, name DESC`;
  // Expected format: ORDER BY on new line, each term indented on subsequent lines, comma-terminated.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "ORDER BY",
    "  department ASC,", // First term
    "  name DESC", // Second term
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

// --- LIMIT and OFFSET Tests ---

test("SELECT with LIMIT", () => {
  const query = sql`SELECT * FROM users LIMIT 10`;
  // Expected format: LIMIT remains on single line.
  const expected = ["SELECT", "  *", "FROM", "  users", "LIMIT 10"].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Adding LIMIT with sql method", () => {
  const query = sql`SELECT * FROM users`;
  const newQuery = query.sql`LIMIT 10`;
  // Expected format: LIMIT added, remains on single line.
  const expected = ["SELECT", "  *", "FROM", "  users", "LIMIT 10"].join("\n");
  assertEquals(newQuery.toString(), expected);
  assertEquals(newQuery.parameters, []);
});

test("SELECT with OFFSET", () => {
  const query = sql`SELECT * FROM users OFFSET 20`;
  // Expected format: OFFSET remains on single line.
  const expected = ["SELECT", "  *", "FROM", "  users", "OFFSET 20"].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Adding OFFSET with sql method", () => {
  const query = sql`SELECT * FROM users`;
  const newQuery = query.sql`OFFSET 20`;
  // Expected format: OFFSET added, remains on single line.
  const expected = ["SELECT", "  *", "FROM", "  users", "OFFSET 20"].join("\n");
  assertEquals(newQuery.toString(), expected);
  assertEquals(newQuery.parameters, []);
});

test("LIMIT and OFFSET together (added incrementally)", () => {
  let query = sql`SELECT * FROM users`;
  query = query.sql`LIMIT 10`;
  query = query.sql`OFFSET 20`;
  // Expected format: Each added clause on its own line.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "LIMIT 10",
    "OFFSET 20",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("LIMIT and OFFSET together (initial query)", () => {
  const query = sql`SELECT * FROM users LIMIT 10 OFFSET 20`;
  // Expected format: Each clause on its own line when present initially.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "LIMIT 10",
    "OFFSET 20",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

// --- Parameter Tests ---

test("Parameters in WHERE clause", () => {
  const id = 1;
  const query = sql`SELECT * FROM users WHERE id = ${id}`;
  // Expected format: WHERE formatted, parameter placeholder used.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = $1",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [1]);
});

test("Multiple parameters in WHERE clause", () => {
  const id = 1;
  const name = "John";
  const query = sql`SELECT * FROM users WHERE id = ${id} AND name = ${name}`;
  // Expected format: WHERE formatted with AND on new line.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = $1",
    "AND",
    "  name = $2",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [1, "John"]);
});

test("Parameters added with sql method", () => {
  const id = 1;
  let query = sql`SELECT * FROM users`;
  query = query.sql`WHERE id = ${id}`;
  // Expected format: WHERE added incrementally.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = $1",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [1]);
});

test("Multiple parameters across multiple sql calls", () => {
  const id = 1;
  const name = "John";
  let query = sql`SELECT * FROM users`;
  query = query.sql`WHERE id = ${id}`;
  query = query.sql`AND name = ${name}`;
  // Expected format: Incremental adds with AND on new line.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = $1",
    "AND", // Added AND keyword
    "  name = $2", // Added condition
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [1, "John"]);
});

test("Parameter in LIMIT clause", () => {
  const limit = 10;
  const query = sql`SELECT * FROM users LIMIT ${limit}`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "LIMIT $1", // LIMIT stays single line
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [limit]);
});

test("Parameter in OFFSET clause", () => {
  const offset = 20;
  const query = sql`SELECT * FROM users OFFSET ${offset}`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "OFFSET $1", // OFFSET stays single line
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [offset]);
});

test("Parameters in LIMIT and OFFSET clauses", () => {
  const limit = 10;
  const offset = 20;
  const query = sql`SELECT * FROM users LIMIT ${limit} OFFSET ${offset}`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "LIMIT $1",
    "OFFSET $2",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [limit, offset]);
});

test("Parameter in JOIN ON clause", () => {
  const minOrderId = 100;
  const query = sql`SELECT u.name, o.id FROM users u JOIN orders o ON u.id = o.user_id AND o.id > ${minOrderId}`;
  // Expected format: JOIN formatted with AND on new line in ON clause.
  const expected = [
    "SELECT",
    "  u.name,",
    "  o.id",
    "FROM",
    "  users u",
    "JOIN",
    "  orders o ON u.id = o.user_id",
    "  AND o.id > $1", // AND part of ON clause
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [minOrderId]);
});

test("Parameter in SELECT clause", () => {
  const bonus = 100;
  // Note: Parameters in SELECT are less common but should work
  const query = sql`SELECT name, salary + ${bonus} as total_comp FROM employees`;
  // Expected format: SELECT fields formatted.
  const expected = [
    "SELECT",
    "  name,",
    "  salary + $1 as total_comp", // Parameter in field expression
    "FROM",
    "  employees",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [bonus]);
});

test("Skip undefined values (replaced with NULL literal)", () => {
  const id = 1;
  const name = undefined; // This should become NULL in the query string, not a parameter
  const status = "active";
  const query = sql`SELECT * FROM users WHERE id = ${id} AND name = ${name} AND status = ${status}`;
  // Expected format: WHERE formatted, undefined becomes NULL, ANDs on new lines.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = $1",
    "AND", // AND for name
    "  name = NULL", // undefined replaced with NULL literal
    "AND", // AND for status
    "  status = $2",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [id, status]); // Only id and status are parameters
});

test("Handle null values (passed as parameters)", () => {
  const id = 1;
  const name = null; // This should become parameter $2 with value null
  const query = sql`SELECT * FROM users WHERE id = ${id} AND manager_id = ${name}`;
  // Expected format: WHERE formatted, null becomes parameter $2.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = $1",
    "AND",
    "  manager_id = $2",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [id, null]);
});

// --- Complex Query Tests ---

test("Complex query with multiple clauses built incrementally", () => {
  const name = "John";
  const limit = 10;
  const offset = 5;
  const minDate = "2024-01-01";

  let query = sql`
  SELECT
    u.id,
    u.name,
    u.email,
    o.order_date
  FROM users u
  `; // Initial SELECT and FROM

  query = query.sql`JOIN orders o ON u.id = o.user_id`; // Add JOIN
  query = query.sql`WHERE u.name LIKE ${"%" + name + "%"}`; // Add WHERE
  query = query.sql`AND o.order_date > ${minDate}`; // AND continues the WHERE (the condition written last)
  query = query.sql`GROUP BY u.id, u.name, u.email, o.order_date`; // Add GROUP BY
  query = query.sql`ORDER BY o.order_date DESC`; // Add ORDER BY
  query = query.sql`LIMIT ${limit}`; // Add LIMIT
  query = query.sql`OFFSET ${offset}`; // Add OFFSET

  // Expected format: All clauses formatted according to new rules, reflecting incremental build.
  const expected = [
    "SELECT",
    "  u.id,",
    "  u.name,",
    "  u.email,",
    "  o.order_date",
    "FROM",
    "  users u",
    "JOIN", // Incremental JOIN
    "  orders o ON u.id = o.user_id",
    "WHERE", // Incremental WHERE
    "  u.name LIKE $1",
    "AND", // Incremental AND for WHERE
    "  o.order_date > $2",
    "GROUP BY", // Incremental GROUP BY
    "  u.id,", // Grouping terms formatted
    "  u.name,",
    "  u.email,",
    "  o.order_date",
    "ORDER BY", // Incremental ORDER BY
    "  o.order_date DESC", // Ordering term formatted
    "LIMIT $3", // Incremental LIMIT
    "OFFSET $4", // Incremental OFFSET
  ].join("\n");

  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, ["%John%", minDate, limit, offset]);
});

test("Building query conditionally", () => {
  const filters = {
    hasName: true,
    name: "John",
    minAge: 25,
    hasOrderJoin: true,
    limit: 10,
    offset: undefined,
  };

  let query = sql`SELECT u.id, u.name FROM users u`;

  if (filters.hasOrderJoin) {
    // Applying new JOIN format rule here
    query = query.sql`JOIN orders o ON u.id = o.user_id`;
  }

  let whereClauseAdded = false;
  // Helper function needs to know how to format WHERE vs AND/OR
  const addWhere = (condition: SQLQuery, isFirst: boolean): SQLQuery => {
    if (isFirst) {
      // WHERE keyword on new line, condition indented
      return query.sql`WHERE ${condition}`; // Assuming .sql handles parameter merging
    } else {
      // AND/OR keyword on new line, condition indented
      return query.sql`AND ${condition}`; // Assuming .sql handles parameter merging
    }
  };

  // A helper to correctly create the condition part passed to addWhere
  // This is needed because `addWhere` itself now expects a SQLQuery object
  // representing *just* the condition, not the WHERE/AND keyword.
  const createCondition = (rawCondition: SQLQuery) => {
    // Here, rawCondition is sql`u.name = ${filters.name}` etc.
    // We just return it as is, letting addWhere handle WHERE/AND
    return rawCondition;
  };

  if (filters.hasName) {
    query = addWhere(
      createCondition(sql`u.name = ${filters.name}`),
      !whereClauseAdded,
    );
    whereClauseAdded = true;
  }

  if (filters.minAge) {
    query = addWhere(
      createCondition(sql`u.age >= ${filters.minAge}`),
      !whereClauseAdded,
    );
    whereClauseAdded = true;
  }

  // Add ORDER BY regardless
  // Applying new ORDER BY format rule here
  query = query.sql`ORDER BY u.name ASC`;

  if (filters.limit) {
    // Applying LIMIT format rule here (single line)
    query = query.sql`LIMIT ${filters.limit}`;
  }

  if (filters.offset !== undefined) {
    // Applying OFFSET format rule here (single line)
    query = query.sql`OFFSET ${filters.offset}`;
  }

  // Expected format based on conditional building and new formatting rules.
  const expected = [
    "SELECT",
    "  u.id,",
    "  u.name",
    "FROM",
    "  users u",
    "JOIN", // Incremental JOIN keyword
    "  orders o ON u.id = o.user_id", // JOIN condition indented
    "WHERE", // Incremental WHERE keyword
    "  u.name = $1", // First condition indented
    "AND", // Incremental AND keyword
    "  u.age >= $2", // Second condition indented
    "ORDER BY", // Incremental ORDER BY keyword
    "  u.name ASC", // Ordering term indented
    "LIMIT $3", // Incremental LIMIT
    // No OFFSET clause expected as filters.offset was undefined
  ].join("\n");

  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [filters.name, filters.minAge, filters.limit]);
});

// --- Edge Case Tests ---

test("Empty initial query", () => {
  // An empty template is an empty fragment, not an implicit SELECT *.
  const query = sql``;
  assertEquals(query.toString(), "");
  assertEquals(query.parameters, []);
});

test("Initial query with only parameters (likely invalid SQL)", () => {
  const val1 = 1;
  const val2 = "test";
  // Text that does not start with a clause keyword is a bare fragment and
  // is kept verbatim (no SELECT is invented around it).
  const query = sql`${val1} ${val2}`;
  assertEquals(query.toString(), "$1 $2");
  assertEquals(query.parameters, [val1, val2]);
});

test("SELECT with leading commas (should be cleaned)", () => {
  const query = sql`
  SELECT
    , id
    , name
    , email
  FROM users`;
  // parseInitialQuery cleans leading commas in continuation lines
  // Expected format: SELECT fields formatted correctly.
  const expected = [
    "SELECT",
    "  id,",
    "  name,",
    "  email",
    "FROM",
    "  users",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("SELECT with trailing commas (should be cleaned)", () => {
  const query = sql`
  SELECT
    id,
    name,
    email,
  FROM users`;
  // parseInitialQuery cleans trailing commas
  // Expected format: SELECT fields formatted correctly.
  const expected = [
    "SELECT",
    "  id,",
    "  name,",
    "  email",
    "FROM",
    "  users",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("Query immutability check", () => {
  const id = 1;
  const query1 = sql`SELECT * FROM users`;
  const query2 = query1.sql`WHERE id = ${id}`;
  const query3 = query2.sql`ORDER BY name`;

  // Original query1 is unchanged
  const expected1 = ["SELECT", "  *", "FROM", "  users"].join("\n");
  assertEquals(query1.toString(), expected1);
  assertEquals(query1.parameters, []);

  // query2 has WHERE clause, formatted
  const expected2 = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = $1",
  ].join("\n");
  assertEquals(query2.toString(), expected2);
  assertEquals(query2.parameters, [id]);

  // query3 has WHERE and ORDER BY, formatted
  const expected3 = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  id = $1",
    "ORDER BY", // Incremental ORDER BY
    "  name", // Term indented
  ].join("\n");
  assertEquals(query3.toString(), expected3);
  assertEquals(query3.parameters, [id]);

  // Ensure query2 wasn't mutated by query3 creation
  assertEquals(query2.toString(), expected2);
  assertEquals(query2.parameters, [id]);
});

test("Complex nested SQL functions formatting", () => {
  // Test expecting highly structured, recursive formatting for functions.
  const date = "2025-05-12";
  const query = sql`
    SELECT
      r.*,
      row_to_json(c) as camp_info,
      LOWER(
        CONCAT(
          r.firstname,
          r.lastname,
          REPLACE(REPLACE(TO_CHAR(r.birthDate, 'DDMMYYYY'), '-', ''), '/', '')
        )
      ) AS unique_id,
      a.checked_in_at,
      a.checked_out_at
    FROM registrations r
    LEFT JOIN periods p ON p.id = r.period_id
    LEFT JOIN camps c ON c.id = r.camp_id
    LEFT JOIN attendances a ON r.id = a.registration_id AND a.date = ${date}
    WHERE p.from_date <= ${date}
      AND p.until_date >= ${date}
    ORDER BY r.firstname DESC
  `;

  // UPDATED Expected format with recursive multi-line formatting for functions.
  // NOTE: This test WILL FAIL until SQLQuery.toString() is updated
  // to produce this specific recursive multi-line formatting for functions.
  const expected = [
    "SELECT",
    "  r.*,", // Field 1
    // --- Start of row_to_json ---
    "  row_to_json(", // Function call start
    "    c", // Argument 1
    "  ) as camp_info,", // Function call end + alias
    // --- End of row_to_json ---
    // --- Start of LOWER(CONCAT(REPLACE(REPLACE(TO_CHAR(...))))) ---
    "  LOWER(", // Outer function call start
    "    CONCAT(", // Nested function call start (CONCAT)
    "      r.firstname,", // CONCAT Arg 1
    "      r.lastname,", // CONCAT Arg 2
    "      REPLACE(", // Nested function call start (REPLACE 1)
    "        REPLACE(", // Nested function call start (REPLACE 2)
    "          TO_CHAR(", // Nested function call start (TO_CHAR)
    "            r.birthDate,", // TO_CHAR Arg 1
    "            'DDMMYYYY'", // TO_CHAR Arg 2
    "          ),", // TO_CHAR call end
    "          '-',", // REPLACE 2 Arg 2
    "          ''", // REPLACE 2 Arg 3
    "        ),", // REPLACE 2 call end
    "        '/',", // REPLACE 1 Arg 2
    "        ''", // REPLACE 1 Arg 3
    "      )", // REPLACE 1 call end (This is CONCAT Arg 3)
    "    )", // CONCAT call end
    "  ) AS unique_id,", // LOWER call end + alias
    // --- End of complex nested function ---
    "  a.checked_in_at,", // Field 4
    "  a.checked_out_at", // Field 5
    "FROM", // From clause
    "  registrations r",
    "LEFT JOIN", // Join 1 keyword
    "  periods p ON p.id = r.period_id", // Join 1 condition
    "LEFT JOIN", // Join 2 keyword
    "  camps c ON c.id = r.camp_id", // Join 2 condition
    "LEFT JOIN", // Join 3 keyword
    "  attendances a ON r.id = a.registration_id", // Join 3 condition part 1
    "  AND a.date = $1", // Join 3 condition part 2 (with param)
    "WHERE", // Where clause keyword
    "  p.from_date <= $2", // Condition 1 (with param)
    "AND", // AND keyword
    "  p.until_date >= $3", // Condition 2 (with param)
    "ORDER BY", // Order By clause keyword
    "  r.firstname DESC", // Ordering term
  ].join("\n");

  // Assert exact match. This will likely fail until the main code is updated.
  assertEquals(
    query.toString(),
    expected,
    "Complex function formatting test expects recursive multi-line output; requires SQLQuery.toString() update.",
  );

  // Verify parameters remain correct
  assertEquals(query.parameters, [date, date, date]); // Parameter count should be 3
});

// --- Async Usage Pattern Test ---

test("Async usage pattern", async () => {
  // Simulate async data fetching
  const fetchUser = async (id: number) => {
    await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate delay
    return { id, name: "User " + id };
  };

  const id = 5;
  let query = sql`SELECT * FROM users`;

  // Fetch data asynchronously
  const user = await fetchUser(id);

  // Use the fetched data in the query (incrementally)
  query = query.sql`WHERE name = ${user.name}`;

  // Expected format: WHERE added incrementally, formatted.
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  name = $1",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, ["User 5"]);
});

// --- DML Tests (raw passthrough) ---
// INSERT / UPDATE / DELETE statements are never re-parsed or re-formatted:
// the statement passes through verbatim (trimmed, comments stripped) with
// ${} values lifted to $N parameters. Fragments appended via .sql are
// attached verbatim below the statement.

test("INSERT passes through raw with parameters lifted", () => {
  const registrationId = 123;
  const date = "2025-03-01";
  const userId = 456;

  const query = sql`INSERT INTO attendances (registration_id, date, checked_in_at, checked_in_by)
VALUES (${registrationId}, ${date}, CURRENT_TIMESTAMP, ${userId})
RETURNING *`;

  const expected = [
    "INSERT INTO attendances (registration_id, date, checked_in_at, checked_in_by)",
    "VALUES ($1, $2, CURRENT_TIMESTAMP, $3)",
    "RETURNING *",
  ].join("\n");

  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [registrationId, date, userId]);
});

test("INSERT with ON CONFLICT DO UPDATE passes through raw", () => {
  const registrationId = 123;
  const date = "2025-03-01";
  const session = { userId: 456 };

  const query = sql`INSERT INTO attendances (registration_id, date, checked_in_at, checked_in_by)
VALUES (${registrationId}, ${date}, CURRENT_TIMESTAMP, ${session.userId})
ON CONFLICT (registration_id, date)
DO UPDATE SET checked_in_by = ${session.userId}
WHERE attendances.checked_out_at IS NULL
RETURNING *`;

  // The whole statement — including the DO UPDATE's WHERE — survives intact.
  const expected = [
    "INSERT INTO attendances (registration_id, date, checked_in_at, checked_in_by)",
    "VALUES ($1, $2, CURRENT_TIMESTAMP, $3)",
    "ON CONFLICT (registration_id, date)",
    "DO UPDATE SET checked_in_by = $4",
    "WHERE attendances.checked_out_at IS NULL",
    "RETURNING *",
  ].join("\n");

  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [
    registrationId,
    date,
    session.userId,
    session.userId,
  ]);
});

test("UPDATE passes through raw with parameters lifted", () => {
  const userId = 123;
  const email = "test@example.com";

  const query = sql`UPDATE users
SET email = ${email}
WHERE id = ${userId}
RETURNING id, email`;

  const expected = [
    "UPDATE users",
    "SET email = $1",
    "WHERE id = $2",
    "RETURNING id, email",
  ].join("\n");

  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [email, userId]);
});

test("UPDATE with multi-line SET and complex WHERE passes through raw", () => {
  const userId = 123;
  const email = "test@example.com";
  const firstName = "UpdatedFirstName";
  const isActive = true;

  const query = sql`UPDATE users
SET
  email = ${email},
  first_name = ${firstName},
  is_active = ${isActive},
  updated_at = CURRENT_TIMESTAMP
WHERE
  id = ${userId} AND
  is_active = FALSE OR
  (first_name IS NULL AND last_name IS NULL)
RETURNING id, email, first_name, is_active`;

  // Passthrough preserves the statement exactly as written, including the
  // author's own line breaks and indentation.
  const expected = [
    "UPDATE users",
    "SET",
    "  email = $1,",
    "  first_name = $2,",
    "  is_active = $3,",
    "  updated_at = CURRENT_TIMESTAMP",
    "WHERE",
    "  id = $4 AND",
    "  is_active = FALSE OR",
    "  (first_name IS NULL AND last_name IS NULL)",
    "RETURNING id, email, first_name, is_active",
  ].join("\n");

  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [email, firstName, isActive, userId]);
});

test("DELETE passes through raw", () => {
  const userId = 123;

  const query = sql`DELETE FROM users WHERE id = ${userId} RETURNING id`;

  assertEquals(
    query.toString(),
    "DELETE FROM users WHERE id = $1 RETURNING id",
  );
  assertEquals(query.parameters, [userId]);
});

test("Appending fragments to a DML query attaches them verbatim", () => {
  const userId = 123;
  const cutoff = "2025-01-01";

  let query = sql`DELETE FROM users WHERE id = ${userId}`;
  query = query.sql`AND created_at < ${cutoff}`;
  query = query.sql`RETURNING id`;

  assertEquals(
    query.toString(),
    [
      "DELETE FROM users WHERE id = $1",
      "AND created_at < $2",
      "RETURNING id",
    ].join("\n"),
  );
  assertEquals(query.parameters, [userId, cutoff]);
});

test("DELETE with BETWEEN and mixed AND/OR passes through raw", () => {
  const startDate = "2024-01-01";
  const endDate = "2024-12-31";
  const minAge = 18;
  const city = "London";

  const query = sql`DELETE FROM registrations
WHERE
  created_at BETWEEN ${startDate} AND ${endDate} AND
  attendee_age >= ${minAge} AND
  attendee_city = ${city} OR
  status = 'pending'
RETURNING registration_id, attendee_email, created_at, status`;

  const expected = [
    "DELETE FROM registrations",
    "WHERE",
    "  created_at BETWEEN $1 AND $2 AND",
    "  attendee_age >= $3 AND",
    "  attendee_city = $4 OR",
    "  status = 'pending'",
    "RETURNING registration_id, attendee_email, created_at, status",
  ].join("\n");

  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [startDate, endDate, minAge, city]);
});

test("Throws error for SELECT with RETURNING", () => {
  const queryFn = () => sql`SELECT * FROM users RETURNING id`;
  throws(
    () => queryFn().toString(),
    {
      name: "Error",
      message: /RETURNING clause cannot be used with SELECT statements/,
    },
    "Should throw error when SELECT and RETURNING are combined",
  );

  // Also test if RETURNING is added later
  const query2 = sql`SELECT * FROM users`;
  const queryFn2 = () => query2.sql`RETURNING id`;
  throws(
    () => queryFn2().toString(),
    {
      name: "Error",
      message: /RETURNING clause cannot be used with SELECT statements/,
    },
    "Should throw error when RETURNING is added to SELECT",
  );
});

// --- String-literal / comment / window-function / CROSS JOIN / passthrough tests ---

test("String literal containing AND/OR is not mis-split", () => {
  const query = sql`SELECT * FROM users WHERE company = 'Brand AND Sons' OR notes = 'x OR y'`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  company = 'Brand AND Sons'",
    "OR",
    "  notes = 'x OR y'",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, []);
});

test("'--' inside string literal is preserved", () => {
  const query = sql`SELECT * FROM users WHERE name = 'a--b'`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  name = 'a--b'",
  ].join("\n");
  assertEquals(query.toString(), expected);
});

test("Real line comment stripped; '--' inside literal preserved", () => {
  const commented = sql`SELECT * FROM users WHERE x = 1 -- real comment`;
  const expectedComment = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  x = 1",
  ].join("\n");
  assertEquals(commented.toString(), expectedComment);

  const literal = sql`SELECT * FROM users WHERE name = 'a--b' AND y = 2`;
  const expectedLiteral = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  name = 'a--b'",
    "AND",
    "  y = 2",
  ].join("\n");
  assertEquals(literal.toString(), expectedLiteral);
});

test("Window function with OVER clause preserved", () => {
  const query = sql`SELECT ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn FROM employees`;
  const expected = [
    "SELECT",
    "  ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn",
    "FROM",
    "  employees",
  ].join("\n");
  assertEquals(query.toString(), expected);
});

test("Comma inside string literal in SELECT list not mis-split", () => {
  const query = sql`SELECT 'a,b', c FROM t`;
  const expected = ["SELECT", "  'a,b',", "  c", "FROM", "  t"].join("\n");
  assertEquals(query.toString(), expected);
});

test("CROSS JOIN recognised as JOIN clause in initial query", () => {
  const query = sql`SELECT u.name FROM users u CROSS JOIN decks d WHERE u.active = true`;
  const expected = [
    "SELECT",
    "  u.name",
    "FROM",
    "  users u",
    "CROSS JOIN",
    "  decks d",
    "WHERE",
    "  u.active = true",
  ].join("\n");
  assertEquals(query.toString(), expected);
});

test("CROSS JOIN appended via .sql() method", () => {
  const query = sql`SELECT u.name FROM users u`.sql`CROSS JOIN decks d`;
  const expected = [
    "SELECT",
    "  u.name",
    "FROM",
    "  users u",
    "CROSS JOIN",
    "  decks d",
  ].join("\n");
  assertEquals(query.toString(), expected);
});

test("CTE / WITH query passes through raw", () => {
  const cte = sql`WITH active_users AS (SELECT id FROM users WHERE active = true) SELECT * FROM active_users`;
  assertEquals(
    cte.toString(),
    "WITH active_users AS (SELECT id FROM users WHERE active = true) SELECT * FROM active_users",
  );
});

test("UNION query passes through raw", () => {
  const union = sql`SELECT id FROM customers UNION SELECT id FROM vendors`;
  assertEquals(
    union.toString(),
    "SELECT id FROM customers UNION SELECT id FROM vendors",
  );
});

// --- Injection-resistance tests ---
// The security model is architectural: _interpolate extracts ${value} into
// `params` (as $N placeholders) BEFORE any parsing/masking/formatting runs.
// These tests empirically lock in that values can never leak into the SQL
// string, regardless of what they contain.

test("Classic SQL injection string becomes a parameter, not concatenated", () => {
  const malicious = "'; DROP TABLE users; --";
  const query = sql`SELECT * FROM users WHERE name = ${malicious}`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  name = $1",
  ].join("\n");
  assertEquals(query.toString(), expected);
  // The dangerous string is intact as a parameter, ready for a parameterized executor.
  assertEquals(query.parameters, [malicious]);
});

test("Value containing SQL syntax is not interpreted", () => {
  const tricky = "OR 1=1; --";
  const query = sql`SELECT id FROM users WHERE token = ${tricky}`;
  const expected = [
    "SELECT",
    "  id",
    "FROM",
    "  users",
    "WHERE",
    "  token = $1",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [tricky]);
});

test("Value containing the internal mask delimiter does not corrupt the mask", () => {
  // The maskStringLiterals helper uses \uE000S<n>\uE000 as a placeholder
  // delimiter. A user value containing that sequence cannot corrupt the mask
  // because values never enter the mask layer — they are extracted into params
  // by _interpolate before any masking runs.
  const weird = "\uE000S0\uE000";
  const query = sql`SELECT * FROM t WHERE x = ${weird}`;
  const expected = ["SELECT", "  *", "FROM", "  t", "WHERE", "  x = $1"].join(
    "\n",
  );
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [weird]);
});

test("Value containing a $N literal is not re-interpreted as a placeholder", () => {
  // The string "cost is $1" is data, not a placeholder reference. Combined with
  // a real parameter, it proves parameter numbering is independent of value
  // contents.
  const id = 5;
  const label = "cost is $1";
  const query = sql`SELECT * FROM products WHERE id = ${id} AND label = ${label}`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  products",
    "WHERE",
    "  id = $1",
    "AND",
    "  label = $2",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [id, label]);
});

test("Identifier passed as a value fails closed (not injection)", () => {
  // Postgres does not allow parameterised identifiers. Passing a column name
  // as a value produces `SELECT $1 FROM users`, which the database will reject
  // at execution time. This is fail-closed behaviour (clear error), not an
  // injection vector. The library never concatenates the identifier into the SQL.
  const col = "name";
  const query = sql`SELECT ${col} FROM users`;
  const expected = ["SELECT", "  $1", "FROM", "  users"].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [col]);
});

// --- Nested-fragment renumbering tests ---
// Regression tests for a bug where inlining a fragment into a query that
// already held parameters renumbered placeholders with sequential replaces,
// so a shifted $N could collide with a not-yet-shifted one
// (e.g. `x = $1 AND c = $3 AND d = $3` with three parameters).

test("Nested fragment after an existing parameter renumbers correctly", () => {
  const frag = sql`b = ${"B"} AND c = ${"C"}`;
  const query = sql`SELECT * FROM t WHERE a = ${"A"} AND ${frag}`;
  const expected = [
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
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, ["A", "B", "C"]);
});

test("Nested fragment appended via .sql renumbers correctly", () => {
  const frag = sql`c = ${"C"} AND d = ${"D"}`;
  let query = sql`SELECT * FROM t WHERE x = ${"X"}`;
  query = query.sql`AND ${frag}`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  t",
    "WHERE",
    "  x = $1",
    "AND",
    "  c = $2",
    "AND",
    "  d = $3",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, ["X", "C", "D"]);
});

test("Nested subquery fragment renumbers inside parentheses", () => {
  const sub = sql`SELECT id FROM orders WHERE total > ${100}`;
  const query = sql`SELECT * FROM users WHERE org = ${"acme"} AND id IN (${sub})`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  org = $1",
    "AND",
    "  id IN (SELECT id FROM orders WHERE total > $2)",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, ["acme", 100]);
});

test("Issue #1 repro: parenthesized OR fragment appended via .sql", () => {
  const cond = sql`(type = ${"admin"} OR role = ${"owner"})`;
  const query = sql`SELECT * FROM users WHERE status = ${"active"}`
    .sql`AND ${cond}`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  users",
    "WHERE",
    "  status = $1",
    "AND",
    "  (type = $2 OR role = $3)",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, ["active", "admin", "owner"]);
});

test("Nested fragment renumbering across the $9 -> $10 boundary", () => {
  // 11 nested params shifted by 1: sequential replaces would turn $1 into
  // $2 and then hit the "1" in $10/$11; \b must keep $1 from matching $10.
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const list = sql`(${1}, ${2}, ${3}, ${4}, ${5}, ${6}, ${7}, ${8}, ${9}, ${10}, ${11})`;
  const query = sql`SELECT * FROM t WHERE a = ${0} AND b IN ${list}`;
  assertEquals(
    query.toString().split("\n").at(-1),
    "  b IN ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
  );
  assertEquals(query.parameters, [0, ...vals]);
});

test("Three-level nesting renumbers every placeholder once", () => {
  const l1 = sql`c = ${"c"} AND d = ${"d"}`;
  const l2 = sql`b = ${"b"} AND ${l1} AND e = ${"e"}`;
  const query = sql`SELECT * FROM t WHERE a = ${"a"} AND ${l2} AND f = ${"f"}`;
  const where = query
    .toString()
    .split("\n")
    .filter((l) => l.includes("="));
  assertEquals(where, [
    "  a = $1",
    "  b = $2",
    "  c = $3",
    "  d = $4",
    "  e = $5",
    "  f = $6",
  ]);
  assertEquals(query.parameters, ["a", "b", "c", "d", "e", "f"]);
});

test("Same fragment nested twice gets distinct placeholders", () => {
  const cond = sql`(type = ${"admin"} OR role = ${"owner"})`;
  const query = sql`SELECT * FROM t WHERE x = ${"x"} AND ${cond} AND ${cond}`;
  const where = query
    .toString()
    .split("\n")
    .filter((l) => l.includes("("));
  assertEquals(where, [
    "  (type = $2 OR role = $3)",
    "  (type = $4 OR role = $5)",
  ]);
  assertEquals(query.parameters, ["x", "admin", "owner", "admin", "owner"]);
});

test("Nested renumbering leaves $N inside string literals alone", () => {
  const frag = sql`note = 'costs $1' AND k = ${"k"}`;
  const query = sql`SELECT * FROM t WHERE a = ${"a"} AND ${frag}`;
  const where = query
    .toString()
    .split("\n")
    .filter((l) => l.includes("="));
  assertEquals(where, ["  a = $1", "  note = 'costs $1'", "  k = $2"]);
  assertEquals(query.parameters, ["a", "k"]);
});

test("Nested fragment with undefined (NULL) keeps numbering dense", () => {
  const frag = sql`p = ${undefined} AND q = ${"q"}`;
  const query = sql`SELECT * FROM t WHERE a = ${"a"} AND ${frag}`;
  const where = query
    .toString()
    .split("\n")
    .filter((l) => l.includes("="));
  assertEquals(where, ["  a = $1", "  p = NULL", "  q = $2"]);
  assertEquals(query.parameters, ["a", "q"]);
});

// --- HAVING tests ---

test("SELECT with GROUP BY and HAVING", () => {
  const min = 5;
  const query = sql`SELECT dept, count(*) FROM employees GROUP BY dept HAVING count(*) > ${min} ORDER BY dept`;
  const expected = [
    "SELECT",
    "  dept,",
    "  count(*)",
    "FROM",
    "  employees",
    "GROUP BY",
    "  dept",
    "HAVING",
    "  count(*) > $1",
    "ORDER BY",
    "  dept",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [min]);
});

test("Adding HAVING with sql method (multiple appends AND together)", () => {
  const minCount = 10;
  const maxTotal = 100000;
  let query = sql`SELECT dept, count(*) FROM employees GROUP BY dept`;
  query = query.sql`HAVING count(*) > ${minCount}`;
  query = query.sql`HAVING sum(salary) < ${maxTotal}`;
  const expected = [
    "SELECT",
    "  dept,",
    "  count(*)",
    "FROM",
    "  employees",
    "GROUP BY",
    "  dept",
    "HAVING",
    "  count(*) > $1",
    "AND",
    "  sum(salary) < $2",
  ].join("\n");
  assertEquals(query.toString(), expected);
  assertEquals(query.parameters, [minCount, maxTotal]);
});

// --- Passthrough append tests ---

test("Appending to a CTE passthrough query attaches fragments verbatim", () => {
  const active = true;
  let query = sql`WITH recent AS (SELECT * FROM orders) SELECT * FROM recent`;
  query = query.sql`WHERE active = ${active}`;
  assertEquals(
    query.toString(),
    [
      "WITH recent AS (SELECT * FROM orders) SELECT * FROM recent",
      "WHERE active = $1",
    ].join("\n"),
  );
  assertEquals(query.parameters, [active]);
});

// --- Fragment comment stripping ---

test("Line comment in an appended fragment is stripped", () => {
  let query = sql`SELECT * FROM t WHERE x = 1`;
  query = query.sql`AND y = 2 -- pending cleanup`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  t",
    "WHERE",
    "  x = 1",
    "AND",
    "  y = 2",
  ].join("\n");
  assertEquals(query.toString(), expected);
});

// --- Top-level comma splitting in term lists ---

test("ORDER BY with function arguments keeps commas inside parens intact", () => {
  const query = sql`SELECT * FROM t ORDER BY coalesce(a, b) DESC, name`;
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  t",
    "ORDER BY",
    "  coalesce(a, b) DESC,",
    "  name",
  ].join("\n");
  assertEquals(query.toString(), expected);
});

test("GROUP BY with function arguments keeps commas inside parens intact", () => {
  const query = sql`SELECT count(*) FROM t GROUP BY date_trunc('day', created_at), region`;
  const expected = [
    "SELECT",
    "  count(*)",
    "FROM",
    "  t",
    "GROUP BY",
    "  date_trunc('day', created_at),",
    "  region",
  ].join("\n");
  assertEquals(query.toString(), expected);
});
