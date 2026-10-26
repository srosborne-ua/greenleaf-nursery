# GreenLeaf – Entity Relationship Diagram

Rendered image: `erd.svg` / `erd.png` (same folder). Source below is Mermaid; GitHub, VS Code (Markdown Preview Mermaid Support) and https://mermaid.live render it directly.

```mermaid
erDiagram
    CATEGORY ||--o{ PRODUCT : "contains"
    PRODUCT ||--o{ PRODUCT_SUPPLIER : "quoted by"
    SUPPLIER ||--o{ PRODUCT_SUPPLIER : "sells"
    CUSTOMER ||--o{ CUSTOMER_ORDER : "places"
    EMPLOYEE ||--o{ CUSTOMER_ORDER : "processes"
    CUSTOMER_ORDER ||--|{ ORDER_ITEM : "has lines"
    PRODUCT ||--o{ ORDER_ITEM : "sold as"
    SUPPLIER ||--o{ PURCHASE : "fulfils"
    EMPLOYEE ||--o{ PURCHASE : "records"
    PURCHASE ||--|{ PURCHASE_ITEM : "has lines"
    PRODUCT ||--o{ PURCHASE_ITEM : "bought as"

    CATEGORY {
        int category_id PK
        varchar name UK
        varchar description
    }
    SUPPLIER {
        int supplier_id PK
        varchar name UK
        varchar contact_name
        varchar email
        varchar phone
        varchar address
    }
    PRODUCT {
        int product_id PK
        varchar sku UK
        varchar name
        varchar description
        int category_id FK
        decimal price "CHECK > 0"
        decimal cost "CHECK >= 0"
        int stock_qty "CHECK >= 0"
        int reorder_level "CHECK >= 0"
    }
    PRODUCT_SUPPLIER {
        int product_id PK, FK
        int supplier_id PK, FK
        decimal unit_cost
    }
    CUSTOMER {
        int customer_id PK
        varchar first_name
        varchar last_name
        varchar email UK
        varchar phone
        varchar address
        datetime created_at
    }
    EMPLOYEE {
        int employee_id PK
        varchar first_name
        varchar last_name
        varchar email UK
        enum role "Employee, Manager"
        date hire_date
    }
    CUSTOMER_ORDER {
        int order_id PK
        int customer_id FK
        int employee_id FK
        datetime order_date
        enum status "Pending, Processing, Completed, Cancelled"
        decimal total_amount
    }
    ORDER_ITEM {
        int order_item_id PK
        int order_id FK "UK with product_id"
        int product_id FK
        int quantity "CHECK > 0"
        decimal unit_price "price at sale"
    }
    PURCHASE {
        int purchase_id PK
        int supplier_id FK
        int employee_id FK
        date purchase_date
        date received_date
        enum status "Ordered, Received, Cancelled"
        decimal total_cost
    }
    PURCHASE_ITEM {
        int purchase_item_id PK
        int purchase_id FK "UK with product_id"
        int product_id FK
        int quantity "CHECK > 0"
        decimal unit_cost
    }
```

## Reading the cardinalities
- `||--o{` one-to-many (exactly one parent, zero or more children). Examples: one category has many products; one customer has many orders.
- `||--|{` one-to-many where the child side is **mandatory** (an order must have at least one line; a purchase must have at least one line – enforced by the API).
- The three many-to-many relationships (product↔supplier, order↔product, purchase↔product) appear as the associative entities `PRODUCT_SUPPLIER`, `ORDER_ITEM` and `PURCHASE_ITEM`.
