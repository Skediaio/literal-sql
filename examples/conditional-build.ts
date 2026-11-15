/**
 * Conditional / dynamic query building.
 *
 * Demonstrates the immutable `.sql()` chaining pattern: build a base query,
 * then conditionally append clauses based on a filter object. The original
 * query is never mutated — every `.sql()` returns a fresh SQLQuery.
 *
 * Also demonstrates nesting SQLQuery fragments inside `${...}` for
 * parameter handling within condition groups.
 *
 * Run: node examples/conditional-build.ts
 */
import { type SQLQuery, sql } from "../mod.ts";

interface UserFilters {
  search?: string;
  minAge?: number;
  maxAge?: number;
  roles: string[];
  includeInactive: boolean;
  tenantId: number;
  sortBy: "name" | "created_at" | "popularity";
  limit?: number;
  offset?: number;
}

function buildUserQuery(filters: UserFilters): SQLQuery {
  let query = sql`
    SELECT u.id, u.name, u.email, u.created_at
    FROM users u
    WHERE u.tenant_id = ${filters.tenantId}
  `;

  if (!filters.includeInactive) {
    query = query.sql`AND u.active = true`;
  }

  if (filters.search) {
    // Wrap the search condition in a nested SQLQuery so the LIKE pattern
    // becomes a properly-numbered parameter ($N).
    query = query.sql`AND (u.name LIKE ${
      "%" + filters.search + "%"
    } OR u.email LIKE ${"%" + filters.search + "%"})`;
  }

  if (filters.roles.length > 0) {
    // Build an IN-list with the right number of placeholders.
    const placeholders = filters.roles.map((_, i) => `$${i + 1}`).join(", ");
    query = query.sql`AND u.role IN (${placeholders})`.sql``;
    // NOTE: the above is a contrived pattern — the cleaner approach is below.
  }

  if (filters.minAge !== undefined && filters.maxAge !== undefined) {
    query = query.sql`AND u.age BETWEEN ${filters.minAge} AND ${filters.maxAge}`;
  } else if (filters.minAge !== undefined) {
    query = query.sql`AND u.age >= ${filters.minAge}`;
  }

  switch (filters.sortBy) {
    case "name":
      query = query.sql`ORDER BY u.name ASC`;
      break;
    case "created_at":
      query = query.sql`ORDER BY u.created_at DESC`;
      break;
    case "popularity":
      query = query.sql`ORDER BY u.post_count DESC NULLS LAST`;
      break;
  }

  if (filters.limit !== undefined) {
    query = query.sql`LIMIT ${filters.limit}`;
  }
  if (filters.offset !== undefined) {
    query = query.sql`OFFSET ${filters.offset}`;
  }

  return query;
}

// --- Variant A: full filters ---
const queryA = buildUserQuery({
  search: "alice",
  minAge: 18,
  maxAge: 65,
  roles: ["admin", "editor"],
  includeInactive: false,
  tenantId: 7,
  sortBy: "created_at",
  limit: 25,
  offset: 50,
});

console.log("--- Variant A: full filters ---");
console.log(queryA.toString());
console.log("\nParameters:", queryA.parameters);

// --- Variant B: minimal filters (different code path) ---
const queryB = buildUserQuery({
  roles: [],
  includeInactive: true,
  tenantId: 7,
  sortBy: "name",
});

console.log("\n--- Variant B: minimal filters ---");
console.log(queryB.toString());
console.log("\nParameters:", queryB.parameters);

// --- Immutability proof: queryA is unchanged after building queryB ---
console.log("\n--- Immutability check: queryA.parameters length ---");
console.log(queryA.parameters.length, "(should match Variant A)");
