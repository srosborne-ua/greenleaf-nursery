-- ============================================================================
-- GreenLeaf - five management reports
--
-- This file is the single source of truth: the API (API/routes/reports.js)
-- parses it, so each block must keep the header format
--     -- REPORT <n>: <title>
--     -- QUESTION: <business question>
--     -- EXPLAIN: <what the query does>
-- followed by exactly one statement ending in ';'.
--
-- Cancelled orders never count as sales, and only Received purchases count as
-- money actually spent / stock actually received.
-- ============================================================================
USE greenleaf;

-- REPORT 1: Best-selling products
-- QUESTION: Which products sell the most units, and which category are they in?
-- EXPLAIN: JOINs order_item, customer_order, product and category; SUM(quantity) is units sold and SUM(quantity*unit_price) is revenue per product. Top 10 by units.
SELECT p.sku,
       p.name                         AS product,
       c.name                         AS category,
       SUM(oi.quantity)               AS units_sold,
       SUM(oi.quantity * oi.unit_price) AS revenue
FROM order_item oi
JOIN customer_order o ON o.order_id   = oi.order_id
JOIN product        p ON p.product_id = oi.product_id
JOIN category       c ON c.category_id = p.category_id
WHERE o.status <> 'Cancelled'
GROUP BY p.product_id, p.sku, p.name, c.name
ORDER BY units_sold DESC, revenue DESC
LIMIT 10;

-- REPORT 2: Sales revenue by product category
-- QUESTION: Which categories bring in the most money, and how much gross profit do they make?
-- EXPLAIN: JOIN + SUM + GROUP BY category. Revenue uses the price at time of sale; profit subtracts the product's current unit cost.
SELECT c.name                                          AS category,
       COUNT(DISTINCT o.order_id)                      AS orders,
       SUM(oi.quantity)                                AS units_sold,
       SUM(oi.quantity * oi.unit_price)                AS revenue,
       SUM(oi.quantity * (oi.unit_price - p.cost))     AS gross_profit
FROM order_item oi
JOIN customer_order o ON o.order_id   = oi.order_id
JOIN product        p ON p.product_id = oi.product_id
JOIN category       c ON c.category_id = p.category_id
WHERE o.status <> 'Cancelled'
GROUP BY c.category_id, c.name
ORDER BY revenue DESC;

-- REPORT 3: Monthly sales revenue
-- QUESTION: How does revenue change month to month (seasonality)?
-- EXPLAIN: GROUP BY year and month of order_date with COUNT of orders and SUM of order totals; average order value is AVG(total_amount).
SELECT YEAR(o.order_date)               AS sales_year,
       MONTH(o.order_date)              AS sales_month,
       DATE_FORMAT(o.order_date, '%Y-%m') AS period,
       COUNT(*)                         AS orders,
       SUM(o.total_amount)              AS revenue,
       ROUND(AVG(o.total_amount), 2)    AS avg_order_value
FROM customer_order o
WHERE o.status <> 'Cancelled'
GROUP BY YEAR(o.order_date), MONTH(o.order_date), DATE_FORMAT(o.order_date, '%Y-%m')
ORDER BY sales_year, sales_month;

-- REPORT 4: Products with low inventory
-- QUESTION: Which products are below their reorder level, how short are they, and who should we reorder from?
-- EXPLAIN: Compares stock_qty to reorder_level and JOINs product_supplier/supplier, keeping each product's cheapest supplier (correlated MIN subquery). on_order counts units already on open (Ordered) purchases; suggested_order tops stock plus on-order up to twice the reorder level.
SELECT p.sku,
       p.name                              AS product,
       c.name                              AS category,
       p.stock_qty,
       p.reorder_level,
       p.reorder_level - p.stock_qty       AS shortfall,
       (SELECT COALESCE(SUM(pi.quantity), 0)
          FROM purchase_item pi
          JOIN purchase pu ON pu.purchase_id = pi.purchase_id
         WHERE pi.product_id = p.product_id AND pu.status = 'Ordered') AS on_order,
       GREATEST((p.reorder_level * 2) - p.stock_qty - (
         SELECT COALESCE(SUM(pi.quantity), 0)
           FROM purchase_item pi
           JOIN purchase pu ON pu.purchase_id = pi.purchase_id
          WHERE pi.product_id = p.product_id AND pu.status = 'Ordered'), 0) AS suggested_order,
       s.name                              AS cheapest_supplier,
       s.phone                             AS supplier_phone,
       ps.unit_cost                        AS supplier_unit_cost
FROM product p
JOIN category         c  ON c.category_id = p.category_id
JOIN product_supplier ps ON ps.product_id = p.product_id
JOIN supplier         s  ON s.supplier_id = ps.supplier_id
WHERE p.stock_qty < p.reorder_level
  AND ps.unit_cost = (SELECT MIN(ps2.unit_cost)
                      FROM product_supplier ps2
                      WHERE ps2.product_id = p.product_id)
ORDER BY shortfall DESC, p.name;

-- REPORT 5: Supplier purchase analysis
-- QUESTION: Which suppliers do we spend the most with, and how do their prices compare?
-- EXPLAIN: JOIN supplier/purchase/purchase_item for Received purchases; COUNT(DISTINCT purchases), SUM spend, AVG unit cost, GROUP BY supplier, HAVING total spend above $1,000 to focus on major suppliers.
SELECT s.name                                   AS supplier,
       COUNT(DISTINCT pu.purchase_id)           AS purchases,
       SUM(pi.quantity)                         AS units_bought,
       SUM(pi.quantity * pi.unit_cost)          AS total_spend,
       ROUND(AVG(pi.unit_cost), 2)              AS avg_unit_cost,
       ROUND(SUM(pi.quantity * pi.unit_cost) / COUNT(DISTINCT pu.purchase_id), 2) AS avg_purchase_value
FROM supplier s
JOIN purchase      pu ON pu.supplier_id = s.supplier_id
JOIN purchase_item pi ON pi.purchase_id = pu.purchase_id
WHERE pu.status = 'Received'
GROUP BY s.supplier_id, s.name
HAVING SUM(pi.quantity * pi.unit_cost) > 1000
ORDER BY total_spend DESC;
