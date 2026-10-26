# GreenLeaf – Demo Walkthrough

Shows the two end-to-end transactions in the UI with before/after inventory checks, plus one failing order that rolls back. Numbers assume a **freshly loaded `seed.sql`** (re-run `schema.sql` + `seed.sql` to reset). Open http://localhost:3000.

Products used
| Product | SKU | Seed stock | Reorder level |
|---|---|---:|---:|
| Fiddle Leaf Fig 10" Pot ($59.99) | IND-004 | 3 | 5 (already low) |
| Monstera Deliciosa 8" Pot ($34.99) | IND-001 | 22 | 8 |
| Peace Lily 8" Pot | IND-006 | 4 | 8 (already low) |

---

## Part A – Customer order (stock decreases)

1. **Record the "before" stock.** Go to **Inventory**, search `Fiddle` and `Monstera`: Fiddle = **3**, Monstera = **22**. (Also note the **Orders** count: 40.)
2. Go to **Shop**, search `Monstera`, set quantity **2**, click **Add to cart**. Search `Fiddle`, quantity **1**, **Add to cart**. The cart badge shows **3**.
3. Open **Cart**. Check the lines and the total ($34.99 × 2 + $59.99 = **$129.97**).
4. Choose a customer (or click **+ New customer**, fill the form – try submitting it empty first to see client-side validation), choose the employee, click **Place order**.
5. The order detail opens: status **Pending**, 2 line items, total $129.97.
6. **After check.** Go to **Inventory**: Monstera = **20**, Fiddle = **2** (still highlighted as low). Orders count is now 41.
7. In the order detail, click **Mark Processing**, then **Mark Completed** to see status updates.

## Part B – Failing order rolls back (nothing is saved)

The cart refuses quantities above stock, so create the conflict like two cashiers would – with two browser tabs.

0. Open **two browser tabs** on the app *before adding anything to the cart* (the cart is stored in the browser, so the second tab must start empty).
1. **Tab 1:** Shop → add **Monstera ×1** and **Fiddle Leaf Fig ×2** to the cart (stock is 2 after Part A, so this is allowed). Open the **Cart** tab view but **don't place the order yet**.
2. **Tab 2:** Shop → add **Fiddle Leaf Fig ×1**, pick any customer, place the order. Fiddle stock is now **1**.
3. **Tab 1:** click **Place order**. The red message appears:
   *"Order not placed - insufficient stock: Fiddle Leaf Fig 10" Pot (requested 2, only 1 in stock)"*.
4. **Verify the rollback.** In **Inventory**: Fiddle is still **1** and **Monstera has not moved** (it was valid, and the transaction had already inserted and decremented it before the Fiddle shortage was found – the `ROLLBACK` undid it). In **Orders** there is **no new order** from Tab 1 (count only grew by Tab 2's order).

Same proof from a terminal (stock 1, order 5):
```bash
curl -s -X POST localhost:3000/api/orders -H 'Content-Type: application/json' \
  -d '{"customer_id":1,"employee_id":1,"items":[{"product_id":1,"quantity":1},{"product_id":4,"quantity":5}]}'
# -> 409 {"error":"Order not placed - insufficient stock: Fiddle Leaf Fig ..."}
curl -s localhost:3000/api/products/1 | grep -o '"stock_qty":[0-9]*'   # unchanged
```

## Part C – Cancel an order (stock is restored)

1. **Orders** → open the Part A order (or any Pending one) → **Cancel order (restock)**.
2. **Inventory**: Monstera and Fiddle quantities from that order are back (Monstera +2, Fiddle +1). The order is **Cancelled** and final.

## Part D – Supplier purchase receipt (stock increases)

1. **Before:** Inventory → search `Peace Lily`: stock **4**, reorder level 8, status **Low**, *On order* **20** (an open purchase from the seed data).
2. Go to **Purchases → + New purchase**. Supplier **Sunrise Greenhouses**; ordered by any employee; the line-item dropdown only lists Sunrise's products. Pick **Peace Lily 8" Pot**, quantity **12** (unit cost auto-fills **$9.75**; total **$117.00**). Leave "already received" unchecked. **Create purchase**.
3. The purchase is listed as **Ordered**. **Inventory** still shows Peace Lily = **4**, but *On order* now shows **32** (20 + 12) – stock only changes on receipt.
4. **Purchases** → **Details** on the new purchase → **Mark received (add to inventory)**. Status becomes **Received** with today's received date.
5. **After:** Inventory → Peace Lily = **16**, status **OK**, and *On order* is back to **20**.
6. Try **Mark received** again: the button is gone, and the API answers 409 ("Only Ordered purchases can be received") so stock is never double-counted. Received purchases also cannot be deleted.

## Part E – Friendly constraint errors (optional)
- **Categories** → delete *Indoor Plants*: "This category still has products…".
- **Customers** → delete a customer with orders: "…has orders and cannot be deleted".
- **Products** → new product with price `0`: blocked in the browser; with a duplicate SKU: "That SKU is already used by another product."

## Automated check
`cd API && npm test` (server running, freshly seeded DB) runs 83 assertions covering all of the above, including the rollback case.
