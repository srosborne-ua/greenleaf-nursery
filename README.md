# GreenLeaf – Plant Nursery Sales & Inventory System

MIS 330 Group Project 1 · Project #3. A complete database-driven web application for a local nursery that sells indoor plants, outdoor plants, flowers, pots, fertilizers, tools and supplies. It automates **product sales, customer orders, supplier purchases and inventory management**, and gives managers five SQL reports.

**Stack:** MySQL (InnoDB) · Node.js + Express + `mysql2` (promise API) · plain HTML/CSS/JavaScript single-page client using `fetch()`. One `npm start` serves both the API and the client.

**What is graded here (and where to find it)**
| Emphasis | Where |
|---|---|
| Database design | `Docs/entities.md`, `Docs/erd.md` (+ `erd.png/svg`), `Docs/relational-schema.md` |
| Implementation | `Database/schema.sql`, `Database/seed.sql`, `Database/reports.sql` |
| Front-end / database integration | `API/` (REST + transactions) and `Client/` |
| Reports (Task 2) | `Database/reports.sql`, `Docs/reports.md`, the **Reports** screen |

---

## 1. Prerequisites
- **MySQL 8.0+** (developed on MySQL 26.7 from Homebrew; any 8.x works – it needs `CHECK` constraints and `utf8mb4_0900_ai_ci`).
- **Node.js 18+** (developed on 20) and npm.
- macOS/Linux/Windows shell. Docker is *not* required.

## 2. Setup, step by step

### 2.1 Get a MySQL server running
Pick **one**:

**A. You already have MySQL and an admin account** – skip to 2.2.

**B. Use the project-local MySQL (what this project was built and tested with)** – it starts a private server on `127.0.0.1:3307` with its own data folder, leaving any other MySQL untouched:
```bash
cd Project
Database/start-local-mysql.sh          # first run initializes the data dir; root has no password
mysql -uroot --socket=mysql.sock -e "
  CREATE USER IF NOT EXISTS 'greenleaf_app'@'127.0.0.1' IDENTIFIED BY 'greenleaf_pw';
  CREATE USER IF NOT EXISTS 'greenleaf_app'@'localhost'  IDENTIFIED BY 'greenleaf_pw';
  GRANT ALL ON greenleaf.* TO 'greenleaf_app'@'127.0.0.1';
  GRANT ALL ON greenleaf.* TO 'greenleaf_app'@'localhost';"
```
(The grant on `greenleaf.*` works before the database exists.) Stop it later with `mysqladmin -uroot --socket=mysql.sock shutdown`.

### 2.2 Create the database, load the schema and the sample data
`schema.sql` drops and recreates the `greenleaf` database, so it is safe to re-run any time (it resets everything).
```bash
# local instance (option B)
mysql -uroot --socket=mysql.sock < Database/schema.sql
mysql -uroot --socket=mysql.sock < Database/seed.sql

# your own MySQL (option A) – use an account that can CREATE DATABASE
mysql -u root -p < Database/schema.sql
mysql -u root -p < Database/seed.sql
# ...then create an app user if you don't want the API to use root:
#   CREATE USER 'greenleaf_app'@'localhost' IDENTIFIED BY 'your_password';
#   GRANT ALL ON greenleaf.* TO 'greenleaf_app'@'localhost';
```
Expected after loading: 7 categories, 47 products, 7 suppliers, 18 customers, 5 employees, 40 orders (148 lines, 8 different months), 14 purchases, 9 products below reorder level.

### 2.3 Configure the API
```bash
cd API
cp .env.example .env      # then edit the values
```
`.env` keys: `PORT` (default 3000), `DB_HOST`, `DB_PORT` (3306 for a normal MySQL, **3307** for the local instance), `DB_USER`, `DB_PASSWORD`, `DB_NAME` (`greenleaf`). A ready-to-use `.env` for the local instance (option B) is already in the repo folder; `.env` is git-ignored.

### 2.4 Install and run
```bash
npm install
npm start
```
Open **http://localhost:3000** – the same server serves the UI (`Client/`) and the API (`/api/...`).

### 2.5 Verify it works (optional)
With the server running and a freshly seeded DB:
```bash
npm test         # 83 end-to-end API checks incl. transactions, rollback, filters, FK errors, reports
```
To reset the data after testing, re-run the two `mysql ... < Database/*.sql` commands.

---

## 3. Using the app
The top-right **Viewing as** switch (Customer / Employee / Manager) hides screens the role would not use; it is a demo aid, not security.

| Screen | What you can do |
|---|---|
| **Shop** | Server-side search box, category filter, min/max price, in-stock-only, sorting; add to cart (quantity capped at stock) |
| **Cart** | Edit quantities, remove lines, choose or **+ New customer**, choose the processing employee, **Place order** (a real DB transaction) |
| **Orders** | Filter by status / date range / customer; open an order to see line items; change status (Pending, Processing, Completed, Cancelled); delete open orders |
| **Customers** | Full CRUD + name/email search |
| **Inventory** | Stock, reorder level, units on order, stock value, OK/Low/Out status; low-stock rows highlighted; filters |
| **Purchases** | Create a purchase from a supplier with line items, edit/cancel while *Ordered*, **Mark received** (adds stock) |
| **Products** | Full CRUD, supplier links with quoted costs, search/filter |
| **Categories / Suppliers / Employees** | Full CRUD |
| **Reports** | The five SQL reports with their business question and explanation beside each table, and a *Show SQL* toggle |

Step-by-step demo with before/after inventory checks and a failing order that rolls back: **`Docs/demo-walkthrough.md`**.

---

## 4. Database schema summary
Full detail (every column, type, constraint) is in `CLAUDE.md` and `Docs/entities.md`; ERD in `Docs/erd.md` / `Docs/erd.png`.

```
category 1──* product *──* supplier        (product_supplier: unit_cost)
customer 1──* customer_order *──* product  (order_item: quantity, unit_price)
employee 1──* customer_order
supplier 1──* purchase *──* product        (purchase_item: quantity, unit_cost)
employee 1──* purchase
```
Ten tables: `category`, `supplier`, `product`, `product_supplier`, `customer`, `employee`, `customer_order`, `order_item`, `purchase`, `purchase_item`. Highlights: PK on every table, FK with `RESTRICT`/`CASCADE` chosen per relationship, `UNIQUE` on SKU/emails/names, `CHECK` constraints (`price > 0`, `stock_qty >= 0`, `quantity > 0`, …), indexes on name/category/price/stock/status/date columns, `product.reorder_level` for low-stock logic. In 3NF with four documented, controlled denormalizations (price/cost snapshots, stored totals, stock level) – see `Docs/relational-schema.md`.

## 5. Business transactions (real MySQL transactions)
Both use `BEGIN … COMMIT/ROLLBACK` and `SELECT … FOR UPDATE` on the product rows (always locked in ascending id order, so no deadlocks and no overselling).

1. **Customer order** (`POST /api/orders`): validate customer/employee → lock products → insert order → for each line insert `order_item` and decrement stock (a short item is recorded, not skipped silently) → if any shortage, throw → **ROLLBACK** of the header, the lines and the decrements, answer `409` listing every short product → else compute the total from the lines → **COMMIT**. Cancelling or deleting an open order restores stock in its own transaction.
2. **Supplier purchase receipt** (`POST /api/purchases/:id/receive`, or `receive_now` on create): lock the purchase row → require status *Ordered* (prevents double receipt) → lock products → increase stock → set *Received* + received date → **COMMIT**.

Proven by the test suite: a failed order leaves order count and stock unchanged; 8 concurrent orders for a product with 3 in stock produce exactly 3 successes.

## 6. API endpoints
All paths are under `/api`; bodies and responses are JSON with **snake_case** keys that match the database columns. Errors are `{ "error": "message", "details": ... }` with HTTP 400 (validation), 404 (not found), 409 (business rule / foreign-key / duplicate), 500.

### Categories `/categories`
| Method | Path | Notes |
|---|---|---|
| GET | `/categories?q=` | list (with `product_count`), search name/description |
| GET | `/categories/:id` | one |
| POST | `/categories` | `{name, description?}` → 201 |
| PUT | `/categories/:id` | replace |
| DELETE | `/categories/:id` | 409 if it still has products |

### Suppliers `/suppliers`
| Method | Path | Notes |
|---|---|---|
| GET | `/suppliers?q=` | list with `product_count`, `purchase_count` |
| GET | `/suppliers/:id` | one |
| GET | `/suppliers/:id/products` | products the supplier sells with quoted `unit_cost` |
| POST / PUT | `/suppliers`, `/suppliers/:id` | `{name, contact_name?, email?, phone?, address?}` |
| DELETE | `/suppliers/:id` | 409 if it has purchases |

### Customers `/customers`
| Method | Path | Notes |
|---|---|---|
| GET | `/customers?q=` | search first/last name, full name or email; includes `order_count` |
| GET | `/customers/:id` | one |
| POST / PUT | `/customers`, `/customers/:id` | `{first_name, last_name, email, phone?, address?}`; duplicate email → 409 |
| DELETE | `/customers/:id` | 409 if the customer has orders |

### Employees `/employees`
| Method | Path | Notes |
|---|---|---|
| GET | `/employees?q=` | list |
| GET | `/employees/:id` | one |
| POST / PUT | `/employees`, `/employees/:id` | `{first_name, last_name, email, role: Employee\|Manager, hire_date}` |
| DELETE | `/employees/:id` | 409 if they processed orders/purchases |

### Products `/products`
| Method | Path | Notes |
|---|---|---|
| GET | `/products` | filters: `q` (name/SKU/description), `category_id`, `min_price`, `max_price`, `in_stock=1`, `low_stock=1`, `sort` = `name_asc\|name_desc\|price_asc\|price_desc\|stock_asc\|stock_desc\|category` |
| GET | `/products/:id` | includes `suppliers: [{supplier_id, supplier_name, unit_cost}]` |
| POST | `/products` | `{sku, name, description?, category_id, price, cost, stock_qty?, reorder_level?, suppliers?: [{supplier_id, unit_cost}]}` |
| PUT | `/products/:id` | replace (the `suppliers` list, when sent, replaces the links) |
| DELETE | `/products/:id` | 409 if on any order or purchase |

### Orders `/orders`
| Method | Path | Notes |
|---|---|---|
| GET | `/orders` | filters: `status`, `from`, `to` (YYYY-MM-DD), `customer_id` |
| GET | `/orders/:id` | header + `items` |
| POST | `/orders` | **transaction.** `{customer_id, employee_id, items: [{product_id, quantity}]}` → 201 order, or 409 on insufficient stock (nothing saved) |
| PATCH | `/orders/:id/status` | `{status}`; allowed: Pending↔Processing, →Completed, →Cancelled (restocks). Completed/Cancelled are final |
| PUT | `/orders/:id` | `{customer_id, employee_id}` reassign (open orders only) |
| DELETE | `/orders/:id` | open orders are restocked; Completed orders → 409 |

### Purchases `/purchases`
| Method | Path | Notes |
|---|---|---|
| GET | `/purchases` | filters: `status`, `supplier_id`, `from`, `to` |
| GET | `/purchases/:id` | header + `items` |
| POST | `/purchases` | `{supplier_id, employee_id, purchase_date?, receive_now?, items: [{product_id, quantity, unit_cost}]}`; lines must be products that supplier sells |
| PUT | `/purchases/:id` | replace header + lines (Ordered only) |
| POST | `/purchases/:id/receive` | **transaction.** Ordered → Received, adds stock |
| POST | `/purchases/:id/cancel` | Ordered → Cancelled |
| DELETE | `/purchases/:id` | not for Received |

### Inventory, reports, health
| Method | Path | Notes |
|---|---|---|
| GET | `/inventory?q=&category_id=&low_stock=1` | `{summary, items}` with `stock_status` OK/Low/Out of stock, `on_order`, `stock_value` |
| GET | `/reports` | all five reports `[{id, title, question, explanation, sql, rows}]` |
| GET | `/reports/:id` | one report (1–5) |
| GET | `/health` | DB connectivity check |

Quick example:
```bash
curl 'localhost:3000/api/products?q=rose&max_price=30&sort=price_asc'
curl -X POST localhost:3000/api/orders -H 'Content-Type: application/json' \
  -d '{"customer_id":1,"employee_id":1,"items":[{"product_id":2,"quantity":3}]}'
```

## 7. Security and robustness
- Every query uses `pool.execute()` with `?` placeholders (server-side prepared statements). The only dynamic SQL fragments are whitelisted (`ORDER BY` keys) or built from fixed column lists; `IN (...)` lists are generated as `?,?,?`.
- `LIKE` search text has `%`, `_` and `\` escaped.
- Validation happens in the browser (friendly messages) **and** again on the server (`API/lib/validate.js`), plus database `CHECK`/`UNIQUE`/FK constraints as the last line of defence.
- Deletes blocked by foreign keys return a friendly **409** message instead of a stack trace.
- All user text is HTML-escaped before it is rendered in the page.

## 8. Assumptions
1. **No authentication.** Customer / Employee / Manager are modeled in the data (employee `role`) and in a UI "Viewing as" switch, but there are no logins; the API is open. Adding login would be the first production step.
2. **Walk-in / staff-assisted sales.** Every order names a customer and the employee who processes it (a customer is chosen or created at checkout). There is no payment processing, tax or shipping.
3. **Stock is reserved when the order is placed**, not when it is completed; cancelling puts it back. Completed and Cancelled orders are final.
4. **Price snapshots:** an order line keeps the price at sale; a purchase line keeps the cost paid. Changing a product's price never changes history.
5. **A product can have several suppliers** (`product_supplier`), but a *purchase* is always from one supplier and may only contain products that supplier sells.
6. **Low stock means `stock_qty < reorder_level`** (strictly below). A suggested reorder quantity tops stock + on-order up to twice the reorder level.
7. **Cancelled orders are not sales** and *Ordered/Cancelled* purchases are not spend; reports count only non-cancelled orders and Received purchases.
8. **Seed stock is the current on-hand quantity** after the seeded orders and receipts (it is not re-derived from them); seed totals and line items are internally consistent.
9. **Seed data is fictional**, generated deterministically by `Database/tools/generate-seed.js` (edit and re-run it to change the data). Orders span March–October 2026.
10. **Currency is USD**, dates are stored without time-zone conversion (`DATETIME`/`DATE`).
11. `customer.address` is a single text field (not normalized into street/city/state) because nothing in the system queries address parts.
12. Product stock can be edited directly by a manager (product form) for corrections such as shrinkage; that path is not logged.
13. Table is named `customer_order` because `ORDER` is a reserved word.
14. The local-MySQL helper stores its data in `Project/mysql-data` (a name without a leading dot – this MySQL build crashed on startup with a hidden data directory).

## 9. Folder map
```
Project/
├── README.md                    this file
├── CLAUDE.md                    developer/AI guide: architecture, full schema doc, build log
├── .gitignore
├── API/
│   ├── server.js                Express app: mounts routes, serves Client/, error handler
│   ├── db.js                    mysql2 pool, withTransaction(), placeholders(), likeTerm()
│   ├── .env / .env.example      DB credentials and port
│   ├── package.json
│   ├── lib/
│   │   ├── validate.js          request validator + HttpError
│   │   └── crud.js              generic CRUD router factory
│   ├── routes/
│   │   ├── simple.js            categories, suppliers, customers, employees
│   │   ├── products.js          CRUD + search/filter/sort + supplier links
│   │   ├── orders.js            order transaction, status, delete
│   │   ├── purchases.js         purchase CRUD + receipt transaction
│   │   ├── inventory.js         stock levels + summary
│   │   └── reports.js           runs the queries in Database/reports.sql
│   └── test/api-test.js         83-check end-to-end test
├── Client/
│   ├── index.html               single page; views toggled by JS
│   └── Resources/
│       ├── styles/index.css
│       └── scripts/index.js
├── Database/
│   ├── schema.sql               CREATE DATABASE + 10 tables (re-runnable)
│   ├── seed.sql                 generated sample data
│   ├── reports.sql              the five reports
│   ├── start-local-mysql.sh     optional private MySQL on port 3307
│   └── tools/generate-seed.js   deterministic seed generator
└── Docs/
    ├── requirements.md          functional requirements, business rules, roles
    ├── entities.md              entities, attributes, keys, cardinality
    ├── erd.md / erd.png / erd.svg   ERD (Mermaid source + rendered image)
    ├── relational-schema.md     relations + 3NF justification
    ├── reports.md               the five reports with real results and actions
    └── demo-walkthrough.md      demo script for both transactions + rollback
```
Not in git (see `.gitignore`): `node_modules/`, `.env`, `mysql-data/`, MySQL logs/sockets.

## 10. Troubleshooting
| Symptom | Fix |
|---|---|
| `Cannot reach the server` in the UI | Start the API: `cd API && npm start` |
| `ECONNREFUSED 127.0.0.1:3307` | The local MySQL isn't running – `Database/start-local-mysql.sh` |
| `Access denied for user` | Check `DB_USER`/`DB_PASSWORD` in `API/.env` and that the user was granted `greenleaf.*` |
| `Unknown database 'greenleaf'` | Run `Database/schema.sql` then `Database/seed.sql` |
| Port 3000 busy | Change `PORT` in `.env` |
| Reports empty | Seed data not loaded – run `seed.sql` |
| Tests fail on counts | Tests expect a freshly seeded DB; reload `schema.sql` + `seed.sql` |
