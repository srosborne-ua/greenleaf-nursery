# GreenLeaf – Business Requirements

## 1. Business scenario
GreenLeaf is a local nursery selling indoor plants, outdoor plants, flowers, pots, fertilizers & soil, garden tools and other supplies. It wants to automate **product sales, customer orders, supplier purchases and inventory management**.

Business processes
1. Customers browse and buy products.
2. Employees process orders (Pending → Processing → Completed).
3. The nursery receives stock from suppliers.
4. Inventory updates when products are sold or received.
5. Managers analyze sales and inventory.

## 2. User roles
| Role | What they do | Screens (UI "Viewing as" switch) |
|---|---|---|
| **Customer** | Browse/search products, build a cart, place an order | Shop, Cart |
| **Employee** | Everything a customer can, plus process orders, manage customers, view inventory, create/receive supplier purchases | + Orders, Customers, Inventory, Purchases |
| **Manager** | Everything an employee can, plus maintain products, categories, suppliers, employees and run management reports | + Products, Categories, Suppliers, Employees, Reports |

The role switch is a demo aid that hides screens; the project has **no authentication** (see assumptions in the README).

## 3. Functional requirements

### 3.1 Customer management
- FR-C1 Create, view, edit and delete customers (first/last name, unique email, phone, address).
- FR-C2 Search customers by name or email (server-side).
- FR-C3 A customer can be created on the fly during checkout.
- FR-C4 A customer with orders cannot be deleted (sales history is kept); the user gets a friendly message.

### 3.2 Product management
- FR-P1 Create, view, edit and delete products (unique SKU, name, description, category, price, cost, stock quantity, reorder level).
- FR-P2 Record which suppliers sell each product and at what quoted unit cost.
- FR-P3 A product on any past order or purchase cannot be deleted.

### 3.3 Product categorization
- FR-K1 Create, view, edit and delete categories (unique name).
- FR-K2 A category that still contains products cannot be deleted.

### 3.4 Search and filtering
- FR-S1 Products: keyword (name/SKU/description), category, price range, in-stock-only, low-stock-only, sort (name, price, stock).
- FR-S2 Customers: name / email keyword.
- FR-S3 Orders: status, date range, customer.
- FR-S4 Purchases: status, supplier. Inventory: keyword, category, low-stock only.

### 3.5 Shopping cart / order management
- FR-O1 Add products to a cart, edit quantities, remove lines; cart survives a page reload.
- FR-O2 Checkout: choose or create a customer and choose the processing employee, then place the order.
- FR-O3 View orders with status, view order details (line items), change status (Pending, Processing, Completed, Cancelled).
- FR-O4 Cancelling an order, or deleting an open order, returns its items to inventory. Completed and Cancelled orders are final; Completed orders cannot be deleted.

### 3.6 Inventory management
- FR-I1 Show current stock for every product with its reorder level, units on open purchase orders, stock value, and a status (OK / Low / Out of stock).
- FR-I2 Low-stock products are visually highlighted and can be filtered.
- FR-I3 Stock changes only through order placement/cancellation, purchase receipt, or an explicit manager edit of the product.

### 3.7 Supplier management
- FR-V1 Create, view, edit and delete suppliers (unique name, contact, email, phone, address).
- FR-V2 A supplier with purchase history cannot be deleted.

### 3.8 Purchase management (receiving stock)
- FR-U1 Create a purchase from **one** supplier with one or more line items (product, quantity, unit cost). Only products that supplier sells can be added.
- FR-U2 A purchase starts as *Ordered*; it can be edited, cancelled or deleted while Ordered.
- FR-U3 Marking it *Received* increases inventory by the line quantities and stamps the received date.
- FR-U4 Received purchases are permanent records (cannot be edited, cancelled or deleted).

### 3.9 Reporting (managers)
Five reports (see `reports.md`): best-selling products, revenue by category, monthly revenue, low inventory with supplier info, supplier purchase analysis.

## 4. Business rules
| # | Rule | Enforced by |
|---|---|---|
| BR1 | An order cannot be placed for more than the available stock. | Order transaction (`SELECT … FOR UPDATE`, shortage ⇒ ROLLBACK); `CHECK (stock_qty >= 0)` as a backstop |
| BR2 | Stock decreases when an order is placed and is restored when it is cancelled/deleted. | Order transaction / status transaction |
| BR3 | Stock increases only when a supplier purchase is **received**, and only once. | Purchase receipt transaction (status must be *Ordered*) |
| BR4 | A product belongs to exactly one category. | `product.category_id NOT NULL` + FK |
| BR5 | Each purchase is from exactly one supplier. | `purchase.supplier_id NOT NULL` + FK |
| BR6 | A purchase line must be a product that supplier sells. | `product_supplier` check in the purchase transaction |
| BR7 | Price must be > 0; cost, stock, reorder level ≥ 0; order/purchase quantities > 0. | `CHECK` constraints + API + browser validation |
| BR8 | Emails (customers, employees) and SKUs are unique; category and supplier names are unique. | `UNIQUE` keys |
| BR9 | An order line stores the unit price at the time of sale (later price changes do not rewrite history). | `order_item.unit_price` snapshot |
| BR10 | An order is processed by one employee and belongs to one customer; each order has ≥ 1 line and a total equal to the sum of its lines. | Order transaction computes total from lines |
| BR11 | A product can appear at most once per order and once per purchase. | `UNIQUE (order_id, product_id)`, `UNIQUE (purchase_id, product_id)` |
| BR12 | A product is *low stock* when `stock_qty < reorder_level`. | Query logic (inventory, report 4, shop badge) |
| BR13 | Records that are referenced by history (customers, suppliers, products with sales/purchases, employees) cannot be deleted. | FK `ON DELETE RESTRICT` + friendly HTTP 409 messages |
| BR14 | Order status flow: Pending ↔ Processing → Completed; Pending/Processing → Cancelled; Completed and Cancelled are final. | `NEXT` map in `routes/orders.js` |

## 5. Non-functional requirements
- MySQL (InnoDB) with PK/FK/UNIQUE/CHECK constraints and indexes on search columns.
- All SQL uses parameterized (prepared) statements; no string concatenation of user input.
- Input validated in the browser **and** on the server.
- Single-page UI that is simple, clean, and works at phone width.
