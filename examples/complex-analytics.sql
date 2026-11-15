-- Complex analytics query for CLI testing.
-- Feed to the CLI via:
--   npm run cli -- --file examples/complex-analytics.sql \
--     --where "o.total_amount > 1000" \
--     --and "o.status = 'paid'" \
--     --order-by "total_amount DESC" \
--     --limit 100
--
-- This query exercises: computed SELECT fields, CASE expressions, multiple
-- JOINs with AND in ON clauses, GROUP BY, HAVING (note: HAVING is not
-- parsed by the current SELECT-centric parser — it will be misclassified),
-- ORDER BY with multiple terms, and a window function (ROW_NUMBER OVER).
-- Great for seeing what the CLI formatter does and does not handle.

SELECT
  o.id,
  o.order_date,
  c.name AS customer_name,
  SUM(ol.quantity * ol.unit_price) AS total_amount,
  COUNT(ol.id) AS line_count,
  AVG(ol.unit_price) AS avg_unit_price,
  CASE
    WHEN SUM(ol.quantity * ol.unit_price) > 1000 THEN 'large'
    WHEN SUM(ol.quantity * ol.unit_price) > 100 THEN 'medium'
    ELSE 'small'
  END AS order_size,
  ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY o.order_date DESC) AS customer_order_seq
FROM orders o
JOIN customers c ON c.id = o.customer_id AND c.is_active = true
LEFT JOIN order_lines ol ON ol.order_id = o.id AND ol.deleted_at IS NULL
WHERE o.tenant_id = 42
  AND o.order_date BETWEEN '2025-01-01' AND '2025-12-31'
GROUP BY o.id, o.order_date, c.name, c.id
HAVING SUM(ol.quantity * ol.unit_price) > 0
ORDER BY total_amount DESC, o.order_date ASC
LIMIT 50
OFFSET 0
