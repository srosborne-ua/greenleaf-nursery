# GreenLeaf – Relational Schema

Standard notation: **bold** = primary key (composite keys listed together), *italic* = foreign key (→ referenced relation), `UQ` = unique candidate key.

```
CATEGORY         ( CategoryID PK, Name UQ, Description )

SUPPLIER         ( SupplierID PK, Name UQ, ContactName, Email, Phone, Address )

PRODUCT          ( ProductID PK, SKU UQ, Name, Description,
                   CategoryID FK → CATEGORY,
                   Price, Cost, StockQty, ReorderLevel )

PRODUCT_SUPPLIER ( ProductID PK FK → PRODUCT,
                   SupplierID PK FK → SUPPLIER,
                   UnitCost )

CUSTOMER         ( CustomerID PK, FirstName, LastName, Email UQ, Phone, Address, CreatedAt )

EMPLOYEE         ( EmployeeID PK, FirstName, LastName, Email UQ, Role, HireDate )

CUSTOMER_ORDER   ( OrderID PK,
                   CustomerID FK → CUSTOMER,
                   EmployeeID FK → EMPLOYEE,
                   OrderDate, Status, TotalAmount )

ORDER_ITEM       ( OrderItemID PK,
                   OrderID FK → CUSTOMER_ORDER,
                   ProductID FK → PRODUCT,
                   Quantity, UnitPrice,
                   UQ (OrderID, ProductID) )

PURCHASE         ( PurchaseID PK,
                   SupplierID FK → SUPPLIER,
                   EmployeeID FK → EMPLOYEE,
                   PurchaseDate, ReceivedDate, Status, TotalCost )

PURCHASE_ITEM    ( PurchaseItemID PK,
                   PurchaseID FK → PURCHASE,
                   ProductID FK → PRODUCT,
                   Quantity, UnitCost,
                   UQ (PurchaseID, ProductID) )
```

The physical names in MySQL are snake_case (`product_id`, `stock_qty`, …); see `Database/schema.sql`.

## Referential integrity (foreign keys)
| FK | References | ON DELETE | ON UPDATE |
|---|---|---|---|
| product.category_id | category | RESTRICT | CASCADE |
| product_supplier.product_id | product | CASCADE | CASCADE |
| product_supplier.supplier_id | supplier | CASCADE | CASCADE |
| customer_order.customer_id | customer | RESTRICT | CASCADE |
| customer_order.employee_id | employee | RESTRICT | CASCADE |
| order_item.order_id | customer_order | CASCADE | CASCADE |
| order_item.product_id | product | RESTRICT | CASCADE |
| purchase.supplier_id | supplier | RESTRICT | CASCADE |
| purchase.employee_id | employee | RESTRICT | CASCADE |
| purchase_item.purchase_id | purchase | CASCADE | CASCADE |
| purchase_item.product_id | product | RESTRICT | CASCADE |

## Normalization (3NF)

**1NF** – every attribute is atomic and every table has a primary key. There are no repeating groups: an order's products are rows in `order_item`, not a list column. Addresses are stored as a single text attribute because the system never queries their parts (a deliberate, documented simplification).

**2NF** – no partial dependencies. Tables with a composite candidate key are `product_supplier (product_id, supplier_id)`, `order_item (order_id, product_id)` and `purchase_item (purchase_id, product_id)`. Their non-key attributes (`unit_cost`, `quantity`/`unit_price`, `quantity`/`unit_cost`) describe the *pair*, not either half alone. (`order_item` and `purchase_item` use a surrogate PK for simple row addressing and keep the natural pair as a UNIQUE key, so the dependency analysis holds on the natural key.)

**3NF** – no transitive dependencies; every non-key attribute depends on the key, the whole key, and nothing but the key:
- A product's category *name* is not stored on the product; only `category_id` is, so renaming a category changes one row.
- Supplier details live only in `supplier`; purchases store `supplier_id`.
- Customer and employee names are not copied onto orders; they are reached through the FKs.
- `product_supplier` separates *quoted* supplier cost from the product, because the cost depends on the (product, supplier) pair.

**Deliberate, controlled denormalization** (each justified by the business):
| Column | Why it is stored | How consistency is kept |
|---|---|---|
| `order_item.unit_price` | Historical price at time of sale (a later price change must not alter old sales) | Written once, from the locked product row, inside the order transaction |
| `purchase_item.unit_cost` | Actual cost paid, which can differ from the quote | Written when the purchase is created |
| `customer_order.total_amount`, `purchase.total_cost` | Fast listing and reporting | Recomputed in SQL (`SUM(quantity * price)`) in the same transaction as the lines; verified by a consistency query in the test notes |
| `product.stock_qty` | Current inventory must be fast to read and lockable (`FOR UPDATE`) | Only changed inside order / cancel / receive transactions; `CHECK (stock_qty >= 0)` |
