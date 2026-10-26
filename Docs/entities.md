# GreenLeaf – Entities, Attributes and Relationships

Notation: **PK** primary key, **FK** foreign key, **UQ** unique, **NN** not null. Types are the MySQL types used in `Database/schema.sql`. The ORDER entity is implemented as the table `customer_order` because `ORDER` is a reserved SQL word.

## 1. Entities

### CATEGORY
| Attribute | Type | Keys / constraints | Notes |
|---|---|---|---|
| category_id | INT UNSIGNED AUTO_INCREMENT | **PK** | |
| name | VARCHAR(60) | NN, **UQ** | e.g. "Indoor Plants" |
| description | VARCHAR(255) | | |

### SUPPLIER
| Attribute | Type | Keys / constraints |
|---|---|---|
| supplier_id | INT UNSIGNED AUTO_INCREMENT | **PK** |
| name | VARCHAR(100) | NN, **UQ** |
| contact_name | VARCHAR(100) | |
| email | VARCHAR(120) | |
| phone | VARCHAR(25) | |
| address | VARCHAR(200) | |

### PRODUCT
| Attribute | Type | Keys / constraints | Notes |
|---|---|---|---|
| product_id | INT UNSIGNED AUTO_INCREMENT | **PK** | |
| sku | VARCHAR(20) | NN, **UQ** | |
| name | VARCHAR(120) | NN, indexed | |
| description | VARCHAR(255) | | |
| category_id | INT UNSIGNED | NN, **FK → category** | one category per product |
| price | DECIMAL(10,2) | NN, CHECK > 0, indexed | selling price |
| cost | DECIMAL(10,2) | NN, CHECK ≥ 0 | nursery's unit cost |
| stock_qty | INT | NN, CHECK ≥ 0, default 0, indexed | on-hand inventory |
| reorder_level | INT | NN, CHECK ≥ 0, default 10 | low-stock threshold |

### PRODUCT_SUPPLIER (associative: PRODUCT ⇄ SUPPLIER)
| Attribute | Type | Keys / constraints |
|---|---|---|
| product_id | INT UNSIGNED | **PK (part 1)**, **FK → product** (CASCADE) |
| supplier_id | INT UNSIGNED | **PK (part 2)**, **FK → supplier** (CASCADE) |
| unit_cost | DECIMAL(10,2) | NN, CHECK ≥ 0 – the supplier's quoted cost |

### CUSTOMER
| Attribute | Type | Keys / constraints |
|---|---|---|
| customer_id | INT UNSIGNED AUTO_INCREMENT | **PK** |
| first_name, last_name | VARCHAR(50) | NN (composite index) |
| email | VARCHAR(120) | NN, **UQ** |
| phone | VARCHAR(25) | |
| address | VARCHAR(200) | |
| created_at | DATETIME | NN, default now |

### EMPLOYEE
| Attribute | Type | Keys / constraints |
|---|---|---|
| employee_id | INT UNSIGNED AUTO_INCREMENT | **PK** |
| first_name, last_name | VARCHAR(50) | NN |
| email | VARCHAR(120) | NN, **UQ** |
| role | ENUM('Employee','Manager') | NN, default Employee |
| hire_date | DATE | NN |

### CUSTOMER_ORDER (ORDER)
| Attribute | Type | Keys / constraints |
|---|---|---|
| order_id | INT UNSIGNED AUTO_INCREMENT | **PK** |
| customer_id | INT UNSIGNED | NN, **FK → customer** (RESTRICT), indexed |
| employee_id | INT UNSIGNED | NN, **FK → employee** (RESTRICT), indexed |
| order_date | DATETIME | NN, default now, indexed |
| status | ENUM('Pending','Processing','Completed','Cancelled') | NN, default Pending, indexed |
| total_amount | DECIMAL(12,2) | NN, CHECK ≥ 0 – sum of its lines |

### ORDER_ITEM (order line; associative ORDER ⇄ PRODUCT)
| Attribute | Type | Keys / constraints |
|---|---|---|
| order_item_id | INT UNSIGNED AUTO_INCREMENT | **PK** |
| order_id | INT UNSIGNED | NN, **FK → customer_order** (CASCADE), **UQ (order_id, product_id)** |
| product_id | INT UNSIGNED | NN, **FK → product** (RESTRICT), indexed |
| quantity | INT | NN, CHECK > 0 |
| unit_price | DECIMAL(10,2) | NN, CHECK > 0 – price snapshot at sale |

### PURCHASE (supplier purchase order)
| Attribute | Type | Keys / constraints |
|---|---|---|
| purchase_id | INT UNSIGNED AUTO_INCREMENT | **PK** |
| supplier_id | INT UNSIGNED | NN, **FK → supplier** (RESTRICT) |
| employee_id | INT UNSIGNED | NN, **FK → employee** (RESTRICT) |
| purchase_date | DATE | NN |
| received_date | DATE | NULL until received |
| status | ENUM('Ordered','Received','Cancelled') | NN, default Ordered |
| total_cost | DECIMAL(12,2) | NN, CHECK ≥ 0 |
| *(table CHECK)* | | `Received ⇔ received_date IS NOT NULL` |

### PURCHASE_ITEM (purchase line; associative PURCHASE ⇄ PRODUCT)
| Attribute | Type | Keys / constraints |
|---|---|---|
| purchase_item_id | INT UNSIGNED AUTO_INCREMENT | **PK** |
| purchase_id | INT UNSIGNED | NN, **FK → purchase** (CASCADE), **UQ (purchase_id, product_id)** |
| product_id | INT UNSIGNED | NN, **FK → product** (RESTRICT) |
| quantity | INT | NN, CHECK > 0 |
| unit_cost | DECIMAL(10,2) | NN, CHECK ≥ 0 – cost actually paid |

## 2. Relationships and cardinality

| # | Relationship | Cardinality | Implemented by |
|---|---|---|---|
| R1 | CATEGORY **contains** PRODUCT | 1 : M (a category has 0..* products; a product has exactly 1 category) | `product.category_id` FK |
| R2 | PRODUCT **is supplied by** SUPPLIER | **M : N** (a product may have several suppliers; a supplier sells many products) | associative table `product_supplier` |
| R3 | CUSTOMER **places** ORDER | 1 : M (0..* orders per customer; exactly 1 customer per order) | `customer_order.customer_id` |
| R4 | EMPLOYEE **processes** ORDER | 1 : M | `customer_order.employee_id` |
| R5 | ORDER **contains** PRODUCT | **M : N** (an order has 1..* products, a product is on 0..* orders) | associative table `order_item` (adds quantity, unit_price) |
| R6 | SUPPLIER **fulfils** PURCHASE | 1 : M (each purchase is from exactly 1 supplier) | `purchase.supplier_id` |
| R7 | EMPLOYEE **records** PURCHASE | 1 : M | `purchase.employee_id` |
| R8 | PURCHASE **contains** PRODUCT | **M : N** | associative table `purchase_item` (adds quantity, unit_cost) |

Many-to-many relationships R2, R5 and R8 are each resolved with an associative table; `order_item` and `purchase_item` carry their own attributes (quantity and price/cost) and a surrogate PK plus a UNIQUE pair so a product cannot repeat on one order/purchase. `product_supplier` uses a composite PK.

### Why Product ⇄ Supplier is modeled this way
A product can be bought from several suppliers (e.g. the specialist grower or the general distributor at a higher price). `product_supplier` stores *who can supply what at what quoted cost*; `purchase`/`purchase_item` store *what was actually bought*. Report 4 uses the cheapest quoted supplier to suggest where to reorder, and the purchase form only offers a supplier's own products.

## 3. Delete behaviour summary
| Parent → Child | ON DELETE | Effect |
|---|---|---|
| category → product | RESTRICT | cannot delete a category that has products |
| customer / employee → customer_order, purchase | RESTRICT | history preserved |
| supplier → purchase | RESTRICT | history preserved |
| product → order_item, purchase_item | RESTRICT | history preserved |
| product / supplier → product_supplier | CASCADE | catalogue links removed with their parent |
| customer_order → order_item; purchase → purchase_item | CASCADE | lines die with their header |

All updates are `ON UPDATE CASCADE`.
