# CLAUDE.md – GreenLeaf project guide

Guidance for Claude Code (and humans) working in this folder. Read this first; `README.md` has setup and the endpoint list, `Docs/` has the course deliverables.

## What this is
GreenLeaf: plant-nursery sales & inventory system for **MIS 330 Group Project 1, Project #3**. Grading emphasis: database design, implementation, front-end/database integration. Stack: MySQL (InnoDB) + Node/Express + `mysql2` (promise) + a plain HTML/CSS/JS single-page client.

## Commands
```bash
# start the project-local MySQL (127.0.0.1:3307, root without password, socket Project/mysql.sock)
Database/start-local-mysql.sh

# (re)create + load the database – destructive, resets all data
mysql -uroot --socket=mysql.sock < Database/schema.sql
mysql -uroot --socket=mysql.sock < Database/seed.sql

# regenerate seed.sql (deterministic; edit the generator, never seed.sql by hand)
node Database/tools/generate-seed.js

# run the app  → http://localhost:3000
cd API && npm install && npm start

# end-to-end API test (server running + freshly seeded DB) – expects "83 passed, 0 failed"
cd API && npm test

# run the five reports
mysql -uroot --socket=mysql.sock -t < Database/reports.sql
```
App DB account used by the API (see `API/.env`): `greenleaf_app` / `greenleaf_pw` on port 3307.

## Hard rules for this codebase
1. **Client folder is fixed**: `Client/index.html`, `Client/Resources/styles/index.css`, `Client/Resources/scripts/index.js` only. No extra HTML/CSS/JS files there.
2. **Parameterized SQL only** – `pool.execute(sql, params)`. Never concatenate user input. Dynamic fragments must be whitelisted (see `SORTS` in `routes/products.js`). Don't pass JS numbers to `LIMIT ?` with `execute`.
3. **Stock only changes inside a transaction** (`withTransaction` in `API/db.js`) that first locks product rows with `SELECT … FOR UPDATE` **in ascending `product_id` order**. Keep that order everywhere (orders, cancel, receive) to avoid deadlocks.
4. **API JSON is snake_case**, matching DB columns (no mapping layer).
5. `Database/reports.sql` is the single source of truth for reports: the API parses it (`-- REPORT n: title`, `-- QUESTION:`, `-- EXPLAIN:` headers, one statement per block). Keep that header format. If a report query changes, also update `Docs/reports.md` with real output.
6. `seed.sql` is generated. After changing the generator, reload the DB and rerun `npm test`; update numbers in `Docs/reports.md`/`demo-walkthrough.md` if they changed.
7. **MySQL data-dir gotcha:** the local instance's data dir must not start with a dot (`mysql-data`, not `.mysql-data`) – MySQL 26.7 InnoDB asserts at startup otherwise (`fil0innodb_pages_persistence.cc !tablespace_ids.empty()`).
8. Don't commit `.env`, `node_modules/`, `mysql-data/`, logs (all in `.gitignore`).

## Architecture
```
Browser (Client/index.js)  ──fetch /api/*──▶  Express (API/server.js)  ──mysql2 pool.execute──▶  MySQL greenleaf
        ▲                                         │ also serves Client/ statically
        └─────────────────────────────────────────┘
```
- `server.js` – mounts routers, JSON body parser, static client, **central error handler** (maps `HttpError`, MySQL errno 1062 duplicate → 409, 1451 FK-in-use → 409, 1452 missing FK → 400, 3819 CHECK → 400).
- `db.js` – pool (`decimalNumbers`, `dateStrings`), `withTransaction(fn)`, `placeholders(n)`, `likeTerm(s)` (escapes `% _ \`).
- `lib/validate.js` – `validator(body).str/email/int/num/oneOf/date().done()` collecting all errors → HTTP 400; `idParam`, `wrap` (async errors → middleware), `HttpError`.
- `lib/crud.js` – `crudRouter(cfg)` generic list/get/create/update/delete used by category, supplier, customer, employee (`routes/simple.js`).
- `routes/products.js` – list with filters/sort, CRUD, supplier links replaced inside a transaction.
- `routes/orders.js` – filters, detail, **order transaction**, status machine, restock on cancel/delete.
- `routes/purchases.js` – CRUD, **receipt transaction**, `GET /suppliers/:id/products`.
- `routes/inventory.js`, `routes/reports.js`.
- Client – one script, sections: helpers (`api`, `toast`, `table`, `onAct`) · modal + `formModal` builder (client validation mirrors server) · cart (localStorage, in-memory source of truth) · views (`views.<name>()` re-render on nav; filter bars are static in `index.html`) · generic `crudView()` for categories/suppliers/customers/employees · boot (hash routing, role switch).

## Database schema (MySQL 8+, InnoDB, utf8mb4, DB `greenleaf`)
Naming: snake_case, singular tables, `<table>_id` PKs, FK columns reuse the parent PK name. `ORDER` is reserved ⇒ table `customer_order`. All FKs are `ON UPDATE CASCADE`. `schema.sql` runs `DROP DATABASE IF EXISTS greenleaf` then `DROP TABLE IF EXISTS` in child→parent order, so it is re-runnable.

### category
| column | type | constraints |
|---|---|---|
| category_id | INT UNSIGNED AI | PK |
| name | VARCHAR(60) | NOT NULL, UNIQUE `uq_category_name` |
| description | VARCHAR(255) | NULL |

### supplier
| column | type | constraints |
|---|---|---|
| supplier_id | INT UNSIGNED AI | PK |
| name | VARCHAR(100) | NOT NULL, UNIQUE `uq_supplier_name` |
| contact_name | VARCHAR(100) | |
| email | VARCHAR(120) | |
| phone | VARCHAR(25) | |
| address | VARCHAR(200) | |

### product
| column | type | constraints |
|---|---|---|
| product_id | INT UNSIGNED AI | PK |
| sku | VARCHAR(20) | NOT NULL, UNIQUE `uq_product_sku` |
| name | VARCHAR(120) | NOT NULL, index `idx_product_name` |
| description | VARCHAR(255) | |
| category_id | INT UNSIGNED | NOT NULL, FK → category **RESTRICT**, index |
| price | DECIMAL(10,2) | NOT NULL, `CHECK (price > 0)`, index |
| cost | DECIMAL(10,2) | NOT NULL, `CHECK (cost >= 0)` |
| stock_qty | INT | NOT NULL default 0, `CHECK (stock_qty >= 0)`, index |
| reorder_level | INT | NOT NULL default 10, `CHECK (reorder_level >= 0)` |

Low stock ⇔ `stock_qty < reorder_level`.

### product_supplier  (M:N product ⇄ supplier)
| column | type | constraints |
|---|---|---|
| product_id | INT UNSIGNED | PK(1), FK → product **CASCADE** |
| supplier_id | INT UNSIGNED | PK(2), FK → supplier **CASCADE**, index |
| unit_cost | DECIMAL(10,2) | NOT NULL, `CHECK (unit_cost >= 0)` – supplier's quoted cost |

### customer
| column | type | constraints |
|---|---|---|
| customer_id | INT UNSIGNED AI | PK |
| first_name, last_name | VARCHAR(50) | NOT NULL; composite index `idx_customer_name (last_name, first_name)` |
| email | VARCHAR(120) | NOT NULL, UNIQUE `uq_customer_email` |
| phone | VARCHAR(25) | |
| address | VARCHAR(200) | |
| created_at | DATETIME | NOT NULL default CURRENT_TIMESTAMP |

### employee
| column | type | constraints |
|---|---|---|
| employee_id | INT UNSIGNED AI | PK |
| first_name, last_name | VARCHAR(50) | NOT NULL |
| email | VARCHAR(120) | NOT NULL, UNIQUE `uq_employee_email` |
| role | ENUM('Employee','Manager') | NOT NULL default 'Employee' |
| hire_date | DATE | NOT NULL |

### customer_order
| column | type | constraints |
|---|---|---|
| order_id | INT UNSIGNED AI | PK |
| customer_id | INT UNSIGNED | NOT NULL, FK → customer **RESTRICT**, index |
| employee_id | INT UNSIGNED | NOT NULL, FK → employee **RESTRICT**, index |
| order_date | DATETIME | NOT NULL default CURRENT_TIMESTAMP, index |
| status | ENUM('Pending','Processing','Completed','Cancelled') | NOT NULL default 'Pending', index |
| total_amount | DECIMAL(12,2) | NOT NULL default 0, `CHECK (total_amount >= 0)` – recomputed = Σ(quantity × unit_price) |

### order_item
| column | type | constraints |
|---|---|---|
| order_item_id | INT UNSIGNED AI | PK |
| order_id | INT UNSIGNED | NOT NULL, FK → customer_order **CASCADE**; UNIQUE `uq_order_product (order_id, product_id)` |
| product_id | INT UNSIGNED | NOT NULL, FK → product **RESTRICT**, index |
| quantity | INT | NOT NULL, `CHECK (quantity > 0)` |
| unit_price | DECIMAL(10,2) | NOT NULL, `CHECK (unit_price > 0)` – snapshot of product.price at sale |

### purchase
| column | type | constraints |
|---|---|---|
| purchase_id | INT UNSIGNED AI | PK |
| supplier_id | INT UNSIGNED | NOT NULL, FK → supplier **RESTRICT**, index |
| employee_id | INT UNSIGNED | NOT NULL, FK → employee **RESTRICT**, index |
| purchase_date | DATE | NOT NULL, index |
| received_date | DATE | NULL |
| status | ENUM('Ordered','Received','Cancelled') | NOT NULL default 'Ordered', index |
| total_cost | DECIMAL(12,2) | NOT NULL default 0, `CHECK (total_cost >= 0)` |
| table CHECK `ck_purchase_received` | | `(status='Received' AND received_date IS NOT NULL) OR (status<>'Received' AND received_date IS NULL)` |

### purchase_item
| column | type | constraints |
|---|---|---|
| purchase_item_id | INT UNSIGNED AI | PK |
| purchase_id | INT UNSIGNED | NOT NULL, FK → purchase **CASCADE**; UNIQUE `uq_purchase_product (purchase_id, product_id)` |
| product_id | INT UNSIGNED | NOT NULL, FK → product **RESTRICT**, index |
| quantity | INT | NOT NULL, `CHECK (quantity > 0)` |
| unit_cost | DECIMAL(10,2) | NOT NULL, `CHECK (unit_cost >= 0)` – cost actually paid |

### Relationships
`category 1─* product` · `product *─* supplier` via `product_supplier` · `customer 1─* customer_order` · `employee 1─* customer_order` · `customer_order *─* product` via `order_item` · `supplier 1─* purchase` · `employee 1─* purchase` · `purchase *─* product` via `purchase_item`.

### Delete behaviour
RESTRICT (history is protected, API answers 409 with a friendly message): category→product, customer/employee→order & purchase, supplier→purchase, product→order_item/purchase_item. CASCADE: product/supplier→product_supplier, customer_order→order_item, purchase→purchase_item.

### Normalization & deliberate denormalization
3NF (see `Docs/relational-schema.md`). Stored-on-purpose values: `order_item.unit_price`, `purchase_item.unit_cost` (historical snapshots), `customer_order.total_amount`, `purchase.total_cost` (recomputed with `SUM` in the same transaction as the lines), `product.stock_qty` (current inventory; only changed in transactions).

## Business rules → where enforced
| Rule | Enforcement |
|---|---|
| Can't order more than stock | `routes/orders.js` POST: lock rows, per-line check, shortages ⇒ throw ⇒ ROLLBACK, 409; `CHECK stock_qty>=0` backstop |
| Stock −/+ on order / cancel / delete-open | order transaction; `restoreStock()` in status & delete |
| Stock + only on receipt, once | `receive()` in `routes/purchases.js` requires status Ordered |
| One category per product, one supplier per purchase | NOT NULL FKs |
| Purchase lines limited to supplier's products | `saveItems()` checks `product_supplier` |
| Order status machine | `NEXT` map in `routes/orders.js` (Pending↔Processing→Completed; →Cancelled; Completed/Cancelled final) |
| Completed orders / received purchases can't be deleted | explicit 409 checks |

## Transactions (exact flow)
**Order** `POST /api/orders`: BEGIN → verify customer & employee → `SELECT … FROM product WHERE product_id IN (…) ORDER BY product_id FOR UPDATE` → INSERT header (Pending, total 0) → per line (ascending id): if `stock < qty` record shortage and continue, else INSERT `order_item` (unit_price from locked row) + `UPDATE product SET stock_qty = stock_qty - ?` → if shortages: throw `HttpError(409)` ⇒ `withTransaction` ROLLBACK (header, lines, decrements all undone) → UPDATE total from `SUM(quantity*unit_price)` → COMMIT.
**Receipt** `POST /api/purchases/:id/receive`: BEGIN → `SELECT status … FOR UPDATE` (must be Ordered) → lock the products (ascending id) → `stock_qty = stock_qty + ?` per line → `status='Received', received_date=CURDATE()` → COMMIT.

## Reports (`Database/reports.sql`, explained in `Docs/reports.md`)
1 best-selling products · 2 revenue/profit by category · 3 monthly revenue · 4 low inventory (+ cheapest supplier via correlated MIN, + units on order) · 5 supplier analysis (GROUP BY + HAVING total spend > $1,000). Cancelled orders excluded; only Received purchases count.

## Seed data (`generate-seed.js`, seed 330)
7 categories · 47 products · 86 product_supplier links · 7 suppliers · 18 customers · 5 employees · 40 orders (148 lines, Mar–Oct 2026; 35 Completed, 2 Processing, 3 Cancelled) · 14 purchases (11 Received, 2 Ordered, 1 Cancelled) · 9 products below reorder level. Revenue of non-cancelled orders = $8,367.37.

## Testing & verification done
- `schema.sql` + `seed.sql` load with no errors; consistency queries: 0 orders with total ≠ Σ lines, 0 purchases with total ≠ Σ lines.
- `API/test/api-test.js`: **83 checks pass** – CRUD for categories/suppliers/products/customers/employees/orders/purchases, validation (400), duplicates (409), FK-delete friendly errors, product/customer/order filters, SQL-injection strings, order success, **order rollback (order count and stock unchanged)**, cancel restocks, purchase receive (+ no double receive), inventory, five reports.
- Concurrency: 8 simultaneous orders for a product with stock 3 ⇒ exactly 3×201 and 5×409, final stock 0.
- UI: scripted headless Chrome (puppeteer-core) walked every screen: filters, cart, new customer (client + server validation), order placement/status, product CRUD + duplicate SKU error, purchase create → receive → inventory +12, low-stock filter, FK-delete toast, reports, role switch, mobile width. No console errors except the deliberate 409 responses; no failed network requests.

## Build log (what was done, in order)
1. Created `Project/{API,Client/Resources/{styles,scripts},Database,Docs}` first.
2. Found Homebrew MySQL running but root password unknown ⇒ built a **project-local MySQL** (`start-local-mysql.sh`, port 3307). First attempts crashed on startup; root cause was the hidden `.mysql-data` directory name ⇒ renamed to `mysql-data`.
3. Wrote `schema.sql`; wrote `generate-seed.js` and generated `seed.sql`; loaded both; ran consistency checks.
4. Wrote `reports.sql` and ran it; later added `on_order` to report 4 after noticing 3 low-stock products were already on open purchases.
5. Built the API (db helpers, validator, CRUD factory, simple/products/orders/purchases/inventory/reports routes, error handler); fixed a bug where the reports parser left the `n: title` line inside the SQL; wrote and ran the 83-check test.
6. Built the client (HTML/CSS/JS); ran headless-browser smoke test; fixed uppercase status pill in detail headers and added an inline favicon (removed a 404).
7. Wrote Docs (requirements, entities, ERD + rendered PNG/SVG via mermaid-cli, relational schema, reports with real output, demo walkthrough), README and this file.

## Ideas not done (out of scope)
Authentication/authorization, payments/tax/shipping, order line editing after placement, audit log for manual stock edits, pagination for very large tables, automated UI tests inside the repo.
