/**
 * Formatting test — exercises each multi-line formatting rule in isolation.
 *
 * Every section below targets ONE formatting rule with the minimal SQL that
 * triggers it. Use this to verify exactly how the formatter lays out each
 * construct. Compare the input (in the tagged template) against the output
 * (printed below each section).
 *
 * Formatting rules covered:
 *   1. SELECT field list — one field per line, indented 2, comma-terminated.
 *   2. FROM on its own line, table indented.
 *   3. JOIN keyword on its own line; table + ON indented; AND-conditions
 *      inside ON on their own line.
 *   4. WHERE on its own line; first condition indented; each AND/OR on its
 *      own line at column 0; the following condition indented 2.
 *   5. Parenthesised condition groups stay on one line.
 *   6. GROUP BY / ORDER BY — one term per line.
 *   7. LIMIT / OFFSET stay on a single line.
 *   8. Parameters renumbered $1, $2, ... across the whole query.
 *   9. Nested function calls expand recursively (one arg per line).
 *  10. `undefined` → NULL literal; `null` → parameter.
 *
 * Run: node examples/formatting-test.ts
 */
import { sql } from "../mod.ts";

// --- (1) SELECT field list ---
console.log("--- (1) SELECT field list (one per line, comma-terminated) ---");
console.log(sql`SELECT id, name, email, created_at FROM users`.toString());

// --- (2) FROM ---
console.log("\n--- (2) FROM on own line, table indented ---");
console.log(sql`SELECT * FROM users u`.toString());

// --- (3) JOIN — keyword on own line, AND inside ON on own line ---
console.log("\n--- (3) JOIN with AND in ON clause ---");
console.log(
  sql`SELECT * FROM users u JOIN orders o ON o.user_id = u.id AND o.total > 0 AND o.status = 'paid'`.toString(),
);

// --- (3b) Multiple JOIN types ---
console.log("\n--- (3b) LEFT JOIN + INNER JOIN sequence ---");
console.log(
  sql`
    SELECT u.name, p.title, c.body
    FROM users u
    LEFT JOIN posts p ON p.user_id = u.id AND p.published = true
    INNER JOIN comments c ON c.post_id = p.id
  `.toString(),
);

// --- (4) WHERE with AND/OR — each on own line at column 0 ---
console.log("\n--- (4) WHERE with mixed AND/OR (operators on own line) ---");
console.log(
  sql`SELECT * FROM products WHERE price > 100 AND category = 'tech' OR featured = true`.toString(),
);

// --- (5) Parenthesised condition groups ---
console.log("\n--- (5) Parenthesised groups preserved on one line ---");
console.log(
  sql`SELECT * FROM users WHERE active = true AND (role = 'admin' OR role = 'editor') AND deleted = false`.toString(),
);

// --- (6) GROUP BY / ORDER BY multiple terms ---
console.log("\n--- (6) GROUP BY + ORDER BY (one term per line) ---");
console.log(
  sql`SELECT department, role, count(*) FROM employees GROUP BY department, role ORDER BY department ASC, role DESC`.toString(),
);

// --- (7) LIMIT / OFFSET (single line each) ---
console.log("\n--- (7) LIMIT + OFFSET stay on single lines ---");
console.log(sql`SELECT * FROM logs LIMIT 100 OFFSET 200`.toString());

// --- (8) Parameter numbering across clauses ---
console.log("\n--- (8) Parameters numbered $1..$N across whole query ---");
const name = "Alice";
const minAge = 25;
const limit = 10;
const offset = 5;
const q8 = sql`SELECT * FROM users WHERE name = ${name} AND age >= ${minAge} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
console.log(q8.toString());
console.log("Parameters:", q8.parameters);

// --- (9) Nested function calls expand recursively ---
console.log("\n--- (9) Nested function expansion ---");
console.log(
  sql`SELECT LOWER(CONCAT(a, b, REPLACE(c, '-', ''))) AS x FROM t`.toString(),
);

// --- (10) undefined → NULL literal; null → parameter ---
console.log("\n--- (10) undefined → NULL literal; null → parameter ---");
const maybeName = undefined;
const maybeManager = null;
const q10 = sql`SELECT * FROM users WHERE name = ${maybeName} AND manager_id = ${maybeManager}`;
console.log(q10.toString());
console.log(
  "Parameters:",
  q10.parameters,
  "(null stays a param, undefined became NULL literal)",
);

// --- (11) Incremental building preserves formatting ---
console.log("\n--- (11) Incremental .sql() appends format consistently ---");
let q11 = sql`SELECT id, name FROM users`;
q11 = q11.sql`WHERE active = true`;
q11 = q11.sql`AND age > 18`;
q11 = q11.sql`ORDER BY name`;
q11 = q11.sql`LIMIT 5`;
console.log(q11.toString());
