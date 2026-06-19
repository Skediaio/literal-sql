/**
 * Showcase — the kitchen-sink query.
 *
 * A realistic analytics query exercising every clause the formatter handles
 * well: computed SELECT fields with aliases, COALESCE, multiple JOINs with
 * AND/OR inside ON, WHERE with mixed AND/OR + parentheses + BETWEEN + IN +
 * LIKE, GROUP BY, ORDER BY with directions, LIMIT/OFFSET, and parameters
 * throughout.
 *
 * Run: deno run --allow-read examples/showcase.ts
 */
import { sql } from "../mod.ts";

const tenantId = 42;
const minTotal = 100;
const maxTotal = 5_000;
const startDate = "2025-01-01";
const endDate = "2025-12-31";
const couponCode = "WINTER20";
const statuses = ["pending", "paid", "shipped"];

const query = sql`
  SELECT
    o.id,
    o.order_date,
    c.name AS customer_name,
    COALESCE(SUM(ol.quantity * ol.unit_price), 0) AS total_amount,
    COUNT(ol.id) AS line_item_count,
    CASE
      WHEN o.shipped_at IS NULL THEN 'pending'
      WHEN o.delivered_at IS NULL THEN 'in_transit'
      ELSE 'delivered'
    END AS fulfillment_state
  FROM orders o
  JOIN customers c ON c.id = o.customer_id AND c.tenant_id = ${tenantId}
  LEFT JOIN order_lines ol ON ol.order_id = o.id AND ol.deleted_at IS NULL
  WHERE o.tenant_id = ${tenantId}
    AND o.order_date BETWEEN ${startDate} AND ${endDate}
    AND o.total_amount BETWEEN ${minTotal} AND ${maxTotal}
    AND o.status IN (${statuses[0]}, ${statuses[1]}, ${statuses[2]})
    AND (
      o.coupon_code = ${couponCode}
      OR o.discount_rate > 0.1
    )
    AND c.name LIKE ${"%" + "Acme" + "%"}
  GROUP BY o.id, o.order_date, c.name, o.shipped_at, o.delivered_at
  ORDER BY total_amount DESC, o.order_date ASC
  LIMIT 50
  OFFSET 10
`;

console.log(query.toString());
console.log("\n--- Parameters ---");
console.log(query.parameters);
console.log(`\n(${query.parameters.length} parameters)`);
