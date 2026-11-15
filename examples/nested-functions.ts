/**
 * Nested functions — recursive multi-line expansion.
 *
 * The formatter expands nested function calls onto indented lines, one
 * argument per line. This is one of the most visually striking features.
 *
 * The first query works correctly (matches sql.test.ts:988). The SECOND
 * query uses window functions (`OVER (...)`) — this is a KNOWN LIMITATION:
 * the formatSelectField regex greedy-captures across the `)` before OVER,
 * so window-function output will be malformed. See for yourself.
 *
 * Run: node examples/nested-functions.ts
 */
import { sql } from "../mod.ts";

const date = "2025-05-12";

// --- Works: deeply nested scalar functions ---
const nested = sql`
  SELECT
    r.id,
    row_to_json(c) AS camp_info,
    LOWER(
      CONCAT(
        r.firstname,
        r.lastname,
        REPLACE(REPLACE(TO_CHAR(r.birthdate, 'DDMMYYYY'), '-', ''), '/', '')
      )
    ) AS unique_id,
    COALESCE(NULLIF(r.nickname, ''), r.firstname) AS display_name
  FROM registrations r
`;

console.log("--- (1) Deeply nested scalar functions — works ---");
console.log(nested.toString());

// --- Known limitation: window functions ---
const window_ = sql`
  SELECT
    u.id,
    u.name,
    ROW_NUMBER() OVER (PARTITION BY u.tenant_id ORDER BY u.created_at DESC) AS row_num,
    SUM(o.total_amount) OVER (PARTITION BY u.id ORDER BY o.order_date) AS running_total,
    RANK() OVER (ORDER BY u.lifetime_value DESC) AS value_rank
  FROM users u
  JOIN orders o ON o.user_id = u.id
  WHERE u.created_at > ${date}
`;

console.log(
  "\n--- (2) Window functions — KNOWN LIMITATION (output will be malformed) ---",
);
console.log(window_.toString());
console.log("\nParameters:", window_.parameters);
