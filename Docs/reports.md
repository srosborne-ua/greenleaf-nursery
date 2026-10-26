# GreenLeaf – Management Reports (Task 2)

The five queries live in `Database/reports.sql` (the API reads that same file, so the UI always shows exactly this SQL). Results below were produced by running the file against the freshly loaded `seed.sql` data (40 orders, 14 purchases). Cancelled orders are excluded from sales; only *Received* purchases count as spend.

**Requirement coverage:** JOINs in reports 1, 2, 4, 5 · aggregates (SUM/COUNT/AVG) in 1, 2, 3, 5 · GROUP BY in 1, 2, 3, 5 · **GROUP BY + HAVING** in report 5 · correlated subqueries in report 4.

Run them yourself: `mysql -u greenleaf_app -p greenleaf < Database/reports.sql`, or open **Reports** in the web app.

---

## Report 1 – Best-selling products
**Business question:** Which products sell the most units, and which category are they in?

```sql
SELECT p.sku, p.name AS product, c.name AS category,
       SUM(oi.quantity) AS units_sold,
       SUM(oi.quantity * oi.unit_price) AS revenue
FROM order_item oi
JOIN customer_order o ON o.order_id   = oi.order_id
JOIN product        p ON p.product_id = oi.product_id
JOIN category       c ON c.category_id = p.category_id
WHERE o.status <> 'Cancelled'
GROUP BY p.product_id, p.sku, p.name, c.name
ORDER BY units_sold DESC, revenue DESC
LIMIT 10;
```

Sample result (top 6 of 10):

| sku | product | category | units_sold | revenue |
|---|---|---|---:|---:|
| POT-001 | Terracotta Pot 6" | Pots & Planters | 24 | $167.76 |
| SUP-001 | Pine Bark Mulch 2 cu ft | Supplies | 23 | $149.27 |
| IND-002 | Snake Plant Laurentii 6" Pot | Indoor Plants | 15 | $299.85 |
| FLO-005 | Sunflower Giant 1 gal | Flowers | 15 | $134.85 |
| FER-005 | Compost Premium 1 cu ft | Fertilizers & Soil | 15 | $119.85 |
| OUT-002 | Japanese Maple 5 gal | Outdoor Plants | 14 | $1,259.86 |

**What it tells the manager:** Volume leaders are cheap staples – the #1 and #2 sellers (6" terracotta pot, bark mulch) together bring in only $317.03 – while the Japanese Maple sells 14 units yet earns $1,259.86, the most revenue of any top-10 product. Units and dollars tell different stories.

**Action to consider:** Use the high-volume, low-price items as traffic builders: bundle the 6" Terracotta Pot (70 in stock) with Snake Plant and other indoor plants, and keep the Japanese Maple – the dollar leader – from running out (9 in stock, reorder level 4) heading into fall planting season.

---

## Report 2 – Sales revenue by product category
**Business question:** Which categories bring in the most money, and how much gross profit do they make?

```sql
SELECT c.name AS category,
       COUNT(DISTINCT o.order_id)                  AS orders,
       SUM(oi.quantity)                            AS units_sold,
       SUM(oi.quantity * oi.unit_price)            AS revenue,
       SUM(oi.quantity * (oi.unit_price - p.cost)) AS gross_profit
FROM order_item oi
JOIN customer_order o ON o.order_id   = oi.order_id
JOIN product        p ON p.product_id = oi.product_id
JOIN category       c ON c.category_id = p.category_id
WHERE o.status <> 'Cancelled'
GROUP BY c.category_id, c.name
ORDER BY revenue DESC;
```

| category | orders | units_sold | revenue | gross_profit |
|---|---:|---:|---:|---:|
| Outdoor Plants | 18 | 50 | $3,304.50 | $1,772.10 |
| Indoor Plants | 20 | 77 | $1,863.23 | $1,053.13 |
| Garden Tools | 15 | 33 | $865.67 | $491.47 |
| Pots & Planters | 16 | 56 | $774.44 | $456.04 |
| Supplies | 16 | 59 | $750.91 | $434.61 |
| Flowers | 12 | 52 | $434.98 | $273.53 |
| Fertilizers & Soil | 9 | 36 | $373.64 | $224.94 |

**What it tells the manager:** Outdoor Plants are 39.5% of the $8,367.37 total revenue and 37.7% of the $4,705.82 gross profit ($1,772.10). Flowers have the best margin (62.9% of revenue vs 53.6% for outdoor plants) but only $434.98 in sales, and Fertilizers & Soil appear on just 9 of the orders.

**Action to consider:** Stock more outdoor plants (shrubs, trees) *before spring* – they drive the most revenue and profit. Promote flowers (high margin, low sales) and add a fertilizer/potting-mix suggestion at checkout to the 28 of 37 orders that currently don't include any.

---

## Report 3 – Monthly sales revenue
**Business question:** How does revenue change month to month (seasonality)?

```sql
SELECT YEAR(o.order_date) AS sales_year, MONTH(o.order_date) AS sales_month,
       DATE_FORMAT(o.order_date, '%Y-%m') AS period,
       COUNT(*) AS orders, SUM(o.total_amount) AS revenue,
       ROUND(AVG(o.total_amount), 2) AS avg_order_value
FROM customer_order o
WHERE o.status <> 'Cancelled'
GROUP BY YEAR(o.order_date), MONTH(o.order_date), DATE_FORMAT(o.order_date, '%Y-%m')
ORDER BY sales_year, sales_month;
```

| period | orders | revenue | avg_order_value |
|---|---:|---:|---:|
| 2026-03 | 5 | $1,144.01 | $228.80 |
| 2026-04 | 6 | $1,160.99 | $193.50 |
| 2026-05 | 7 | $1,482.83 | $211.83 |
| 2026-06 | 4 | $697.68 | $174.42 |
| 2026-07 | 3 | $1,334.14 | $444.71 |
| 2026-08 | 3 | $711.18 | $237.06 |
| 2026-09 | 3 | $561.64 | $187.21 |
| 2026-10 | 6 | $1,274.90 | $212.48 |

**What it tells the manager:** Spring (Mar–May) is the peak: $3,787.83, or 45% of all revenue, with May the best month ($1,482.83). Summer then falls off – September is the low point at $561.64 (3 orders). July looks strong only because of a few large baskets (average order $444.71 on 3 orders). October is rebounding with 6 orders.

**Action to consider:** Order spring inventory (especially outdoor plants) in February, and plan a late-summer/early-fall promotion (e.g. "fall planting" on shrubs and trees) to lift the June, August and September slump.

---

## Report 4 – Products with low inventory
**Business question:** Which products are below their reorder level, how short are they, is stock already on order, and who should we reorder from?

```sql
SELECT p.sku, p.name AS product, c.name AS category, p.stock_qty, p.reorder_level,
       p.reorder_level - p.stock_qty AS shortfall,
       (SELECT COALESCE(SUM(pi.quantity), 0) FROM purchase_item pi
          JOIN purchase pu ON pu.purchase_id = pi.purchase_id
         WHERE pi.product_id = p.product_id AND pu.status = 'Ordered') AS on_order,
       GREATEST((p.reorder_level * 2) - p.stock_qty - (<same on_order subquery>), 0) AS suggested_order,
       s.name AS cheapest_supplier, s.phone AS supplier_phone, ps.unit_cost AS supplier_unit_cost
FROM product p
JOIN category         c  ON c.category_id = p.category_id
JOIN product_supplier ps ON ps.product_id = p.product_id
JOIN supplier         s  ON s.supplier_id = ps.supplier_id
WHERE p.stock_qty < p.reorder_level
  AND ps.unit_cost = (SELECT MIN(ps2.unit_cost) FROM product_supplier ps2
                      WHERE ps2.product_id = p.product_id)
ORDER BY shortfall DESC, p.name;
```
(The full text, with the subquery written out, is in `Database/reports.sql`.)

| sku | product | stock | reorder | shortfall | on order | suggested order | cheapest supplier | unit cost |
|---|---|---:|---:|---:|---:|---:|---|---:|
| FLO-002 | Marigold Orange 4" Pot | 12 | 20 | 8 | 10 | 18 | Bloom & Petal Growers | $1.30 |
| SUP-003 | Plant Labels 50-pack | 7 | 15 | 8 | 0 | 23 | Southern Garden Distributors | $1.40 |
| IND-006 | Peace Lily 8" Pot | 4 | 8 | 4 | 20 | 0 | Sunrise Greenhouses | $9.75 |
| OUT-003 | Boxwood Green Velvet 3 gal | 7 | 10 | 3 | 0 | 13 | Evergreen Wholesale Nursery | $12.00 |
| FLO-006 | Geranium Red 6" Pot | 9 | 12 | 3 | 20 | 0 | Bloom & Petal Growers | $4.70 |
| POT-005 | Hanging Basket Coco Liner 12" | 5 | 8 | 3 | 0 | 11 | TerraCotta Traders | $6.10 |
| TOL-003 | Watering Can 2 gal Galvanized | 2 | 5 | 3 | 0 | 8 | IronLeaf Tool Supply | $12.50 |
| IND-004 | Fiddle Leaf Fig 10" Pot | 3 | 5 | 2 | 20 | 0 | Sunrise Greenhouses | $28.00 |
| FER-004 | Rose Fertilizer Slow Release 4 lb | 8 | 10 | 2 | 0 | 12 | GrowWell Fertilizer Co | $6.20 |

**What it tells the manager:** 9 of 47 products (19%) are below reorder level, but 3 of them (Peace Lily, Geranium, Fiddle Leaf Fig) already have 20 units each on open purchases, so only 6 need a new order. Bringing those 6 up to twice their reorder level costs **$453.10** at the cheapest quoted prices. The most urgent are the ones nearly gone with nothing coming: Watering Can (2 left, reorder at 5) and Plant Labels (7 of 15).

**Action to consider:** Place purchase orders for the six uncovered items (Marigold ×18 and Boxwood ×13 are the biggest by units; Watering Can ×8 from IronLeaf Tool Supply is the most urgent), and chase delivery of the Sunrise Greenhouses order that will clear the Peace Lily and Fiddle Leaf Fig shortages. Consider raising the reorder level on Watering Can so it triggers earlier.

---

## Report 5 – Supplier purchase analysis (GROUP BY + HAVING)
**Business question:** Which suppliers do we spend the most with, and how do their prices compare?

```sql
SELECT s.name AS supplier,
       COUNT(DISTINCT pu.purchase_id)  AS purchases,
       SUM(pi.quantity)                AS units_bought,
       SUM(pi.quantity * pi.unit_cost) AS total_spend,
       ROUND(AVG(pi.unit_cost), 2)     AS avg_unit_cost,
       ROUND(SUM(pi.quantity * pi.unit_cost) / COUNT(DISTINCT pu.purchase_id), 2) AS avg_purchase_value
FROM supplier s
JOIN purchase      pu ON pu.supplier_id = s.supplier_id
JOIN purchase_item pi ON pi.purchase_id = pu.purchase_id
WHERE pu.status = 'Received'
GROUP BY s.supplier_id, s.name
HAVING SUM(pi.quantity * pi.unit_cost) > 1000
ORDER BY total_spend DESC;
```

| supplier | purchases | units_bought | total_spend | avg_unit_cost | avg_purchase_value |
|---|---:|---:|---:|---:|---:|
| Evergreen Wholesale Nursery | 2 | 170 | $3,762.25 | $22.64 | $1,881.13 |
| IronLeaf Tool Supply | 1 | 105 | $1,220.50 | $10.97 | $1,220.50 |
| TerraCotta Traders | 2 | 145 | $1,128.00 | $8.12 | $564.00 |

**What it tells the manager:** `HAVING` keeps only the 3 suppliers with more than $1,000 in received purchases; the other 4 together account for $2,166.70. Evergreen Wholesale Nursery alone is **$3,762.25 of the $8,277.45 total (45%)**, concentrated in two orders averaging $1,881.13, and its higher average unit cost ($22.64) reflects the expensive trees and shrubs it supplies.

**Action to consider:** Negotiate a volume discount (target 5–8%) with Evergreen, because it is our biggest supplier at 45% of spend; at the same time keep Southern Garden Distributors (who quote about 8% above the specialists on every product) as the backup so one supplier delay cannot empty the outdoor plant section.
