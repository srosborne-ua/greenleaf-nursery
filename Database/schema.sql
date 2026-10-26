-- ============================================================================
-- GreenLeaf Nursery - MySQL schema
-- MIS 330 Group Project 1, Project #3
--
-- Re-runnable: drops and recreates the database every time.
--   mysql -u <user> -p < Database/schema.sql
--
-- Naming conventions: snake_case, singular table names, <table>_id primary keys,
-- fk columns reuse the parent's PK name. "Order" is a reserved word, so the
-- ORDER entity is the table `customer_order`.
-- ============================================================================

DROP DATABASE IF EXISTS greenleaf;
CREATE DATABASE greenleaf CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE greenleaf;

-- Drop children before parents (harmless on a fresh DB, kept so the order is
-- documented and the script also works if the DROP DATABASE above is removed).
DROP TABLE IF EXISTS purchase_item;
DROP TABLE IF EXISTS purchase;
DROP TABLE IF EXISTS order_item;
DROP TABLE IF EXISTS customer_order;
DROP TABLE IF EXISTS product_supplier;
DROP TABLE IF EXISTS product;
DROP TABLE IF EXISTS supplier;
DROP TABLE IF EXISTS category;
DROP TABLE IF EXISTS employee;
DROP TABLE IF EXISTS customer;

-- ----------------------------------------------------------------------------
-- CATEGORY: a product belongs to exactly one category
-- ----------------------------------------------------------------------------
CREATE TABLE category (
  category_id   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name          VARCHAR(60)   NOT NULL,
  description   VARCHAR(255)  NULL,
  PRIMARY KEY (category_id),
  UNIQUE KEY uq_category_name (name)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- SUPPLIER
-- ----------------------------------------------------------------------------
CREATE TABLE supplier (
  supplier_id   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100)  NOT NULL,
  contact_name  VARCHAR(100)  NULL,
  email         VARCHAR(120)  NULL,
  phone         VARCHAR(25)   NULL,
  address       VARCHAR(200)  NULL,
  PRIMARY KEY (supplier_id),
  UNIQUE KEY uq_supplier_name (name)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- PRODUCT
--   stock_qty     current on-hand inventory (kept in sync by order / receipt
--                 transactions, never negative)
--   reorder_level when stock_qty drops BELOW this the product is "low stock"
-- ----------------------------------------------------------------------------
CREATE TABLE product (
  product_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  sku            VARCHAR(20)   NOT NULL,
  name           VARCHAR(120)  NOT NULL,
  description    VARCHAR(255)  NULL,
  category_id    INT UNSIGNED  NOT NULL,
  price          DECIMAL(10,2) NOT NULL,
  cost           DECIMAL(10,2) NOT NULL,
  stock_qty      INT           NOT NULL DEFAULT 0,
  reorder_level  INT           NOT NULL DEFAULT 10,
  PRIMARY KEY (product_id),
  UNIQUE KEY uq_product_sku (sku),
  KEY idx_product_name (name),
  KEY idx_product_category (category_id),
  KEY idx_product_price (price),
  KEY idx_product_stock (stock_qty),
  CONSTRAINT fk_product_category FOREIGN KEY (category_id)
    REFERENCES category (category_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_product_price   CHECK (price > 0),
  CONSTRAINT ck_product_cost    CHECK (cost >= 0),
  CONSTRAINT ck_product_stock   CHECK (stock_qty >= 0),
  CONSTRAINT ck_product_reorder CHECK (reorder_level >= 0)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- PRODUCT_SUPPLIER: resolves product <-> supplier (M:N). Which suppliers can
-- supply which product, and at what quoted unit cost.
-- ----------------------------------------------------------------------------
CREATE TABLE product_supplier (
  product_id   INT UNSIGNED  NOT NULL,
  supplier_id  INT UNSIGNED  NOT NULL,
  unit_cost    DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (product_id, supplier_id),
  KEY idx_ps_supplier (supplier_id),
  CONSTRAINT fk_ps_product  FOREIGN KEY (product_id)
    REFERENCES product (product_id)   ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT fk_ps_supplier FOREIGN KEY (supplier_id)
    REFERENCES supplier (supplier_id) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT ck_ps_cost CHECK (unit_cost >= 0)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- CUSTOMER
-- ----------------------------------------------------------------------------
CREATE TABLE customer (
  customer_id  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  first_name   VARCHAR(50)   NOT NULL,
  last_name    VARCHAR(50)   NOT NULL,
  email        VARCHAR(120)  NOT NULL,
  phone        VARCHAR(25)   NULL,
  address      VARCHAR(200)  NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id),
  UNIQUE KEY uq_customer_email (email),
  KEY idx_customer_name (last_name, first_name)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- EMPLOYEE (role distinguishes staff from managers)
-- ----------------------------------------------------------------------------
CREATE TABLE employee (
  employee_id  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  first_name   VARCHAR(50)   NOT NULL,
  last_name    VARCHAR(50)   NOT NULL,
  email        VARCHAR(120)  NOT NULL,
  role         ENUM('Employee','Manager') NOT NULL DEFAULT 'Employee',
  hire_date    DATE          NOT NULL,
  PRIMARY KEY (employee_id),
  UNIQUE KEY uq_employee_email (email)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- CUSTOMER_ORDER (the ORDER entity)
--   Stock is deducted when the order is placed and restored if it is cancelled,
--   so every non-cancelled order is already reflected in product.stock_qty.
-- ----------------------------------------------------------------------------
CREATE TABLE customer_order (
  order_id      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  customer_id   INT UNSIGNED  NOT NULL,
  employee_id   INT UNSIGNED  NOT NULL,
  order_date    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status        ENUM('Pending','Processing','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
  total_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id),
  KEY idx_order_customer (customer_id),
  KEY idx_order_employee (employee_id),
  KEY idx_order_status (status),
  KEY idx_order_date (order_date),
  CONSTRAINT fk_order_customer FOREIGN KEY (customer_id)
    REFERENCES customer (customer_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_order_employee FOREIGN KEY (employee_id)
    REFERENCES employee (employee_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_order_total CHECK (total_amount >= 0)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- ORDER_ITEM (order line). unit_price is a snapshot of the product price at
-- the time of sale so later price changes do not rewrite history.
-- ----------------------------------------------------------------------------
CREATE TABLE order_item (
  order_item_id  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  order_id       INT UNSIGNED  NOT NULL,
  product_id     INT UNSIGNED  NOT NULL,
  quantity       INT           NOT NULL,
  unit_price     DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (order_item_id),
  UNIQUE KEY uq_order_product (order_id, product_id),
  KEY idx_oi_product (product_id),
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id)
    REFERENCES customer_order (order_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_oi_product FOREIGN KEY (product_id)
    REFERENCES product (product_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_oi_qty   CHECK (quantity > 0),
  CONSTRAINT ck_oi_price CHECK (unit_price > 0)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- PURCHASE (supplier purchase order). Each purchase is from exactly one
-- supplier. Inventory only increases when status moves Ordered -> Received.
-- ----------------------------------------------------------------------------
CREATE TABLE purchase (
  purchase_id    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  supplier_id    INT UNSIGNED  NOT NULL,
  employee_id    INT UNSIGNED  NOT NULL,
  purchase_date  DATE          NOT NULL,
  received_date  DATE          NULL,
  status         ENUM('Ordered','Received','Cancelled') NOT NULL DEFAULT 'Ordered',
  total_cost     DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (purchase_id),
  KEY idx_purchase_supplier (supplier_id),
  KEY idx_purchase_employee (employee_id),
  KEY idx_purchase_status (status),
  KEY idx_purchase_date (purchase_date),
  CONSTRAINT fk_purchase_supplier FOREIGN KEY (supplier_id)
    REFERENCES supplier (supplier_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_purchase_employee FOREIGN KEY (employee_id)
    REFERENCES employee (employee_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_purchase_total CHECK (total_cost >= 0),
  CONSTRAINT ck_purchase_received CHECK (
    (status = 'Received' AND received_date IS NOT NULL) OR
    (status <> 'Received' AND received_date IS NULL))
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- PURCHASE_ITEM (purchase line)
-- ----------------------------------------------------------------------------
CREATE TABLE purchase_item (
  purchase_item_id  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  purchase_id       INT UNSIGNED  NOT NULL,
  product_id        INT UNSIGNED  NOT NULL,
  quantity          INT           NOT NULL,
  unit_cost         DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (purchase_item_id),
  UNIQUE KEY uq_purchase_product (purchase_id, product_id),
  KEY idx_pi_product (product_id),
  CONSTRAINT fk_pi_purchase FOREIGN KEY (purchase_id)
    REFERENCES purchase (purchase_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pi_product FOREIGN KEY (product_id)
    REFERENCES product (product_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_pi_qty  CHECK (quantity > 0),
  CONSTRAINT ck_pi_cost CHECK (unit_cost >= 0)
) ENGINE=InnoDB;
