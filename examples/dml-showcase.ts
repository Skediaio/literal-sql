/**
 * DML showcase — INSERT / UPDATE / DELETE with RETURNING.
 *
 * DML statements pass through raw: the statement text is preserved exactly
 * as written (trimmed, line comments stripped) and each ${value} is lifted
 * to a $N parameter. The SELECT-centric formatter never touches DML, so
 * ON CONFLICT, DO UPDATE SET, CASE expressions etc. all survive intact.
 * Fragments appended with .sql are attached verbatim below the statement.
 *
 * Run: node examples/dml-showcase.ts
 */
import { sql } from "../mod.ts";

const registrationId = 123;
const date = "2025-03-01";
const userId = 456;
const email = "new@example.com";
const firstName = "Alice";

// --- INSERT with RETURNING ---
const insert = sql`
  INSERT INTO attendances (registration_id, date, checked_in_at, checked_in_by)
  VALUES (${registrationId}, ${date}, CURRENT_TIMESTAMP, ${userId})
  RETURNING *
`;
console.log("--- INSERT with RETURNING ---");
console.log(insert.toString());
console.log("Parameters:", insert.parameters);

// --- INSERT with ON CONFLICT DO UPDATE (the WHERE here is part of DO UPDATE) ---
const upsert = sql`
  INSERT INTO attendances (registration_id, date, checked_in_at, checked_in_by)
  VALUES (${registrationId}, ${date}, CURRENT_TIMESTAMP, ${userId})
  ON CONFLICT (registration_id, date)
  DO UPDATE SET
    checked_out_at = CASE
      WHEN CURRENT_TIMESTAMP - attendances.checked_in_at < interval '5 minutes' THEN NULL
      ELSE CURRENT_TIMESTAMP
    END,
    checked_in_by = ${userId}
  WHERE attendances.checked_out_at IS NULL
  RETURNING *
`;
console.log("\n--- INSERT ... ON CONFLICT DO UPDATE ... WHERE ---");
console.log(upsert.toString());
console.log("Parameters:", upsert.parameters);

// --- UPDATE with multi-branch WHERE + RETURNING multiple columns ---
const update = sql`
  UPDATE users
  SET
    email = ${email},
    first_name = ${firstName},
    updated_at = CURRENT_TIMESTAMP
  WHERE
    id = ${userId} AND
    is_active = FALSE OR
    (first_name IS NULL AND last_name IS NULL)
  RETURNING id, email, first_name
`;
console.log("\n--- UPDATE with OR + parens in WHERE ---");
console.log(update.toString());
console.log("Parameters:", update.parameters);

// --- DELETE with BETWEEN in WHERE ---
const del = sql`
  DELETE FROM registrations
  WHERE
    created_at BETWEEN ${"2024-01-01"} AND ${"2024-12-31"} AND
    attendee_age >= ${18} AND
    attendee_city = ${"London"} OR
    status = 'pending'
  RETURNING registration_id, attendee_email
`;
console.log("\n--- DELETE with BETWEEN + OR ---");
console.log(del.toString());
console.log("Parameters:", del.parameters);
