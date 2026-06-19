/**
 * Edge cases — known limitations of the SELECT-centric parser.
 *
 * Each section below exercises a SQL construct that the current parser does
 * NOT handle correctly. The output is shown so you can see exactly what
 * breaks. These are tracked as follow-up work (see reviewer findings).
 *
 * Run: deno run --allow-read examples/edge-cases.ts
 */
import { sql } from "../mod.ts";

// --- (1) String literal containing AND/OR ---
// The splitConditions scanner is not string-aware, so it splits on AND/OR
// inside quoted strings. Expected: one WHERE condition. Actual: split.
const stringWithAnd =
  sql`SELECT * FROM users WHERE company = 'Brand AND Sons' OR notes = 'x OR y'`;
console.log("--- (1) String literal containing AND/OR — KNOWN BREAKAGE ---");
console.log(stringWithAnd.toString());
console.log("Parameters:", stringWithAnd.parameters);

// --- (2) '--' inside a string literal ---
// parseInitialQuery strips `--[^\n]*` as a comment, including inside strings.
// Expected: WHERE name = 'a--b'. Actual: corrupted.
const dashInString = sql`SELECT * FROM users WHERE name = 'a--b'`;
console.log("\n--- (2) '--' inside string literal — KNOWN BREAKAGE ---");
console.log(dashInString.toString());
console.log("Parameters:", dashInString.parameters);

// --- (3) CTE (WITH ... AS (...)) ---
// The parser has no WITH keyword recognition. The CTE falls through to the
// default branch and is misclassified.
const cte = sql`
  WITH active_users AS (
    SELECT id, name FROM users WHERE active = true
  )
  SELECT * FROM active_users WHERE name LIKE 'A%'
`;
console.log(
  "\n--- (3) CTE / WITH — KNOWN BREAKAGE (no WITH keyword support) ---",
);
console.log(cte.toString());

// --- (4) Subquery in WHERE via nested SQLQuery ---
// A nested SQLQuery fragment used as a condition. Partially works because
// of the "where select" strip hack, but the subquery's internal structure
// is flattened.
const subquery =
  sql`SELECT * FROM orders WHERE user_id IN ${sql`SELECT id FROM users WHERE active = ${true}`}`;
console.log("\n--- (4) Subquery via nested SQLQuery — PARTIAL ---");
console.log(subquery.toString());
console.log("Parameters:", subquery.parameters);

// --- (5) UNION ---
// No UNION keyword support; second SELECT is misclassified.
const union = sql`
  SELECT id, name FROM customers
  UNION
  SELECT id, name FROM vendors
  ORDER BY name
`;
console.log("\n--- (5) UNION — KNOWN BREAKAGE (no UNION support) ---");
console.log(union.toString());

// --- (6) CROSS JOIN / NATURAL JOIN / LATERAL ---
// parseQuery's startsWith chain recognises "left join", "right join",
// "inner join", "full outer join", "join" — but NOT "cross join",
// "natural join", or "lateral join". These fall into the default WHERE branch.
const crossJoin = sql`
  SELECT u.name, d.name AS deck_name
  FROM users u
  CROSS JOIN decks d
  WHERE u.active = true
`;
console.log(
  "\n--- (6) CROSS JOIN — KNOWN BREAKAGE (keyword not recognised) ---",
);
console.log(crossJoin.toString());

// --- (7) Deeply-nested subquery with parameters at every level ---
// Stress-tests the parameter renumbering in _interpolate.
const deepNested = sql`
  SELECT * FROM users
  WHERE id IN ${sql`SELECT user_id FROM orders WHERE total > ${100} AND created_at > ${"2025-01-01"}`}`;
console.log(
  "\n--- (7) Deeply-nested subquery — PARTIAL (parameter renumbering works) ---",
);
console.log(deepNested.toString());
console.log("Parameters:", deepNested.parameters);
