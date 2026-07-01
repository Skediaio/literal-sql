/**
 * Edge cases — SQL constructs that stress the parser/formatter.
 *
 * Most of these were broken before 0.2.0 and are now handled correctly by the
 * string-literal-aware scanners (`maskStringLiterals`, `maskParenGroups`) and
 * the WITH/UNION passthrough. The remaining PARTIAL / UNSUPPORTED sections
 * document the current frontier.
 *
 * Run: deno run --allow-read examples/edge-cases.ts
 */
import { sql } from "../mod.ts";

// --- (1) String literal containing AND/OR — WORKS (was broken before 0.2.0) ---
// splitConditions masks string literals before scanning, so AND/OR inside
// quotes is not treated as a logical operator.
const stringWithAnd =
  sql`SELECT * FROM users WHERE company = 'Brand AND Sons' OR notes = 'x OR y'`;
console.log("--- (1) String literal containing AND/OR — WORKS ---");
console.log(stringWithAnd.toString());
console.log("Parameters:", stringWithAnd.parameters);

// --- (2) '--' inside a string literal — WORKS (was broken before 0.2.0) ---
// The comment stripper is now string-aware: '--' inside quotes is preserved,
// real '-- ...' line comments are still stripped.
const dashInString = sql`SELECT * FROM users WHERE name = 'a--b'`;
console.log("\n--- (2) '--' inside string literal — WORKS ---");
console.log(dashInString.toString());
console.log("Parameters:", dashInString.parameters);

// --- (3) CTE (WITH ... AS (...)) — WORKS via passthrough (was broken) ---
// WITH / UNION / INTERSECT / EXCEPT queries bypass the SELECT-centric parser
// entirely and return the raw query (trimmed). Full structural formatting of
// these is deferred — pass-through avoids silent corruption.
const cte = sql`
  WITH active_users AS (
    SELECT id, name FROM users WHERE active = true
  )
  SELECT * FROM active_users WHERE name LIKE 'A%'
`;
console.log("\n--- (3) CTE / WITH — WORKS (raw passthrough) ---");
console.log(cte.toString());

// --- (4) Subquery in WHERE via nested SQLQuery — WORKS ---
// A nested SQLQuery fragment is inlined as raw SQL text with its $N
// placeholders renumbered past the outer query's parameters in a single
// pass (no collisions). Wrap the fragment in parens yourself — it's SQL.
const subquery =
  sql`SELECT * FROM orders WHERE user_id IN (${sql`SELECT id FROM users WHERE active = ${true}`})`;
console.log("\n--- (4) Subquery via nested SQLQuery — WORKS ---");
console.log(subquery.toString());
console.log("Parameters:", subquery.parameters);

// --- (5) UNION — WORKS via passthrough (was broken) ---
const union = sql`
  SELECT id, name FROM customers
  UNION
  SELECT id, name FROM vendors
  ORDER BY name
`;
console.log("\n--- (5) UNION — WORKS (raw passthrough) ---");
console.log(union.toString());

// --- (6) CROSS JOIN — WORKS (was broken before 0.2.0) ---
// CROSS JOIN and NATURAL {LEFT|RIGHT|INNER|FULL} JOIN variants are now
// recognised by parseQuery and formatJoinClause. (LATERAL is still unsupported
// — it's a subquery modifier, not a JOIN type.)
const crossJoin = sql`
  SELECT u.name, d.name AS deck_name
  FROM users u
  CROSS JOIN decks d
  WHERE u.active = true
`;
console.log("\n--- (6) CROSS JOIN — WORKS ---");
console.log(crossJoin.toString());

// --- (7) Deeply-nested subquery — WORKS (single-pass param renumbering) ---
// Stress-tests parameter renumbering in _interpolate across nesting levels.
// Fragments are inlined from their raw text; renumbering is a single pass,
// so multi-parameter fragments can't collide with outer parameters.
const deepNested = sql`
  SELECT * FROM users
  WHERE id IN (${sql`SELECT user_id FROM orders WHERE total > ${100} AND created_at > ${"2025-01-01"}`})`;
console.log(
  "\n--- (7) Deeply-nested subquery — WORKS (param renumbering) ---",
);
console.log(deepNested.toString());
console.log("Parameters:", deepNested.parameters);

// --- (8) Genuinely unsupported constructs (no silent corruption, but no special handling) ---
// These don't crash but receive no first-class parsing. Documented for honesty.
//
// - Dollar-quoting `$$...$$` / `$tag$...$tag$`: not handled by maskStringLiterals
//   (only single-quoted `'...'` literals are masked). Would matter for Postgres
//   function bodies.
// - `E'...'` C-style escape strings (e.g. `E'\n'`): not handled.
// - Double-quoted identifiers `"..."`: not masked (low practical impact —
//   identifiers rarely contain AND/OR/comma/--).
// - `LATERAL` keyword (e.g. `JOIN LATERAL (SELECT ...)`): not recognised.
// - Window-function argument formatting: the OVER clause is preserved intact
//   (see nested-functions.ts), but its inner structure is not re-indented.
console.log(
  "\n--- (8) Unsupported constructs — see comment above (no demo output) ---",
);
console.log(
  "Dollar-quoting, E'...' escapes, \"...\" identifiers, LATERAL, OVER re-indentation.",
);
