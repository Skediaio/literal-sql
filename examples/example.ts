import { sql } from "../mod.ts";

// Example usage:
let query = sql`
SELECT
  address.id,
  address.neighborhood,
  address.number,
  address.postcode,
  address.street,
  address.createdAt,
  address.deletedAt,
  COALESCE(json_agg(property.*) FILTER (WHERE property.id IS NOT NULL), '[]') AS properties,
  COUNT(property.*)::integer AS propertyCount
FROM address
GROUP BY address.id
`;

const getProperties = true;
const getOwner = true;
const search = "Main St";
const ageLimit = 30;

// Add joins conditionally
if (getProperties) {
  query = query.sql`LEFT JOIN property ON property.ownerId = address.ownerId`;
}

if (getOwner) {
  query = query.sql`LEFT JOIN owner ON owner.id = address.ownerId`;
}

// Add WHERE clauses conditionally
if (search) {
  query = query.sql`WHERE address.street = ${search}`;
  query = query.sql`AND address.postcode = ${search}`;
  query = query.sql`OR address.number = ${search}`;
}

if (ageLimit && search) {
  if (search) {
    // If we already have a WHERE, use AND
    query = query.sql`AND age < ${ageLimit}`;
  } else {
    // Otherwise, add a new WHERE
    query = query.sql`WHERE age < ${ageLimit}`;
  }
}

console.log(query.toString());
console.log("Parameters:", query.parameters);
