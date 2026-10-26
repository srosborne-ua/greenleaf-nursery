// Orders: list/filter, detail, create (TRANSACTION), status changes, delete.
//
// Stock rules
//   * Placing an order decrements product.stock_qty inside ONE transaction.
//   * Cancelling (or deleting an open) order puts the stock back.
//   * Product rows are locked with SELECT ... FOR UPDATE, always in ascending
//     product_id order, so concurrent orders cannot oversell or deadlock.
const express = require('express');
const { pool, placeholders, withTransaction } = require('../db');
const { HttpError, validator, idParam, wrap } = require('../lib/validate');

const router = express.Router();

const STATUSES = ['Pending', 'Processing', 'Completed', 'Cancelled'];
// allowed status transitions; Completed and Cancelled are final
const NEXT = {
  Pending: ['Processing', 'Completed', 'Cancelled'],
  Processing: ['Pending', 'Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

const LIST_SQL = `
  SELECT o.order_id, o.order_date, o.status, o.total_amount,
         o.customer_id, CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
         o.employee_id, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
         (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_item oi WHERE oi.order_id = o.order_id) AS item_count
  FROM customer_order o
  JOIN customer c ON c.customer_id = o.customer_id
  JOIN employee e ON e.employee_id = o.employee_id`;

// GET /api/orders?status=&from=YYYY-MM-DD&to=YYYY-MM-DD&customer_id=
router.get('/', wrap(async (req, res) => {
  const { status, from, to, customer_id } = req.query;
  const where = [];
  const params = [];
  if (status) {
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status filter');
    where.push('o.status = ?'); params.push(status);
  }
  if (from) { where.push('o.order_date >= ?'); params.push(dateOnly(from, 'from')); }
  if (to) { where.push('o.order_date < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(dateOnly(to, 'to')); }
  if (customer_id) { where.push('o.customer_id = ?'); params.push(idParam(customer_id)); }
  const sql = `${LIST_SQL}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY o.order_date DESC, o.order_id DESC`;
  const [rows] = await pool.execute(sql, params);
  res.json(rows);
}));

function dateOnly(s, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`);
  return s;
}

async function readOne(id, conn = pool) {
  const [rows] = await conn.execute(`${LIST_SQL} WHERE o.order_id = ?`, [id]);
  if (!rows[0]) return null;
  const [items] = await conn.execute(
    `SELECT oi.order_item_id, oi.product_id, p.sku, p.name AS product_name, oi.quantity, oi.unit_price,
            oi.quantity * oi.unit_price AS line_total
     FROM order_item oi JOIN product p ON p.product_id = oi.product_id
     WHERE oi.order_id = ? ORDER BY p.name`, [id]);
  return { ...rows[0], items };
}

router.get('/:id', wrap(async (req, res) => {
  const o = await readOne(idParam(req.params.id));
  if (!o) throw new HttpError(404, 'Order not found');
  res.json(o);
}));

// Lock product rows (ascending id) and return them keyed by id
async function lockProducts(conn, ids) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const [rows] = await conn.execute(
    `SELECT product_id, name, price, stock_qty FROM product
     WHERE product_id IN (${placeholders(sorted.length)}) ORDER BY product_id FOR UPDATE`, sorted);
  return new Map(rows.map(r => [r.product_id, r]));
}

// ----------------------------------------------------------------------------
// POST /api/orders   { customer_id, employee_id, items: [{product_id, quantity}] }
// TRANSACTION: BEGIN -> lock products -> insert order + items -> decrement
// stock -> compute total -> COMMIT. Any shortage => ROLLBACK of everything.
// ----------------------------------------------------------------------------
router.post('/', wrap(async (req, res) => {
  const v = validator(req.body).int('customer_id', { required: true, min: 1, label: 'customer' })
    .int('employee_id', { required: true, min: 1, label: 'employee' });
  const head = v.done();

  if (!Array.isArray(req.body.items) || req.body.items.length === 0) throw new HttpError(400, 'An order needs at least one item');
  if (req.body.items.length > 50) throw new HttpError(400, 'An order can have at most 50 line items');
  // merge duplicate products so (order_id, product_id) stays unique
  const wanted = new Map();
  for (const it of req.body.items) {
    const iv = validator(it).int('product_id', { required: true, min: 1 }).int('quantity', { required: true, min: 1, max: 1000 }).done();
    wanted.set(iv.product_id, (wanted.get(iv.product_id) || 0) + iv.quantity);
  }

  const orderId = await withTransaction(async conn => {
    const [cust] = await conn.execute('SELECT customer_id FROM customer WHERE customer_id = ?', [head.customer_id]);
    if (!cust[0]) throw new HttpError(400, 'Selected customer does not exist');
    const [emp] = await conn.execute('SELECT employee_id FROM employee WHERE employee_id = ?', [head.employee_id]);
    if (!emp[0]) throw new HttpError(400, 'Selected employee does not exist');

    const products = await lockProducts(conn, [...wanted.keys()]);
    const missing = [...wanted.keys()].filter(id => !products.has(id));
    if (missing.length) throw new HttpError(400, `Unknown product id(s): ${missing.join(', ')}`);

    const [ins] = await conn.execute(
      "INSERT INTO customer_order (customer_id, employee_id, status, total_amount) VALUES (?, ?, 'Pending', 0)",
      [head.customer_id, head.employee_id]);
    const id = ins.insertId;

    const shortages = [];
    for (const pid of [...wanted.keys()].sort((a, b) => a - b)) {
      const p = products.get(pid);
      const qty = wanted.get(pid);
      if (p.stock_qty < qty) {
        shortages.push({ product_id: pid, name: p.name, requested: qty, available: p.stock_qty });
        continue; // keep scanning so the user sees every problem at once
      }
      await conn.execute('INSERT INTO order_item (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [id, pid, qty, p.price]);
      await conn.execute('UPDATE product SET stock_qty = stock_qty - ? WHERE product_id = ?', [qty, pid]);
    }
    if (shortages.length) {
      // thrown inside the transaction => withTransaction ROLLBACKs the header,
      // the items already inserted and the stock already decremented
      const msg = shortages.map(s => `${s.name} (requested ${s.requested}, only ${s.available} in stock)`).join('; ');
      throw new HttpError(409, `Order not placed - insufficient stock: ${msg}`, { shortages });
    }

    await conn.execute(
      `UPDATE customer_order SET total_amount =
         (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_item WHERE order_id = ?)
       WHERE order_id = ?`, [id, id]);
    return id;
  });

  res.status(201).json(await readOne(orderId));
}));

// Put back the stock of an order's lines (caller already holds the order row lock)
async function restoreStock(conn, orderId) {
  const [items] = await conn.execute(
    'SELECT product_id, quantity FROM order_item WHERE order_id = ? ORDER BY product_id', [orderId]);
  if (!items.length) return;
  await lockProducts(conn, items.map(i => i.product_id));
  for (const it of items) {
    await conn.execute('UPDATE product SET stock_qty = stock_qty + ? WHERE product_id = ?', [it.quantity, it.product_id]);
  }
}

// PATCH /api/orders/:id/status   { status }
router.patch('/:id/status', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const { status } = validator(req.body).oneOf('status', STATUSES, { required: true }).done();
  await withTransaction(async conn => {
    const [rows] = await conn.execute('SELECT status FROM customer_order WHERE order_id = ? FOR UPDATE', [id]);
    if (!rows[0]) throw new HttpError(404, 'Order not found');
    const current = rows[0].status;
    if (current === status) return;
    if (!NEXT[current].includes(status)) {
      throw new HttpError(409, `A ${current} order cannot be changed to ${status}`
        + (NEXT[current].length ? ` (allowed: ${NEXT[current].join(', ')})` : ' (it is final)'));
    }
    if (status === 'Cancelled') await restoreStock(conn, id);
    await conn.execute('UPDATE customer_order SET status = ? WHERE order_id = ?', [status, id]);
  });
  res.json(await readOne(id));
}));

// PUT /api/orders/:id   { customer_id, employee_id }  (only while Pending/Processing)
router.put('/:id', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const d = validator(req.body).int('customer_id', { required: true, min: 1, label: 'customer' })
    .int('employee_id', { required: true, min: 1, label: 'employee' }).done();
  const o = await readOne(id);
  if (!o) throw new HttpError(404, 'Order not found');
  if (!NEXT[o.status].length) throw new HttpError(409, `A ${o.status} order can no longer be edited`);
  await pool.execute('UPDATE customer_order SET customer_id = ?, employee_id = ? WHERE order_id = ?',
    [d.customer_id, d.employee_id, id]);
  res.json(await readOne(id));
}));

// DELETE /api/orders/:id  - open or cancelled orders only; open orders return their stock
router.delete('/:id', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async conn => {
    const [rows] = await conn.execute('SELECT status FROM customer_order WHERE order_id = ? FOR UPDATE', [id]);
    if (!rows[0]) throw new HttpError(404, 'Order not found');
    if (rows[0].status === 'Completed') {
      throw new HttpError(409, 'Completed orders are sales history and cannot be deleted.');
    }
    if (rows[0].status !== 'Cancelled') await restoreStock(conn, id);
    await conn.execute('DELETE FROM customer_order WHERE order_id = ?', [id]); // order_item cascades
  });
  res.json({ message: 'Order deleted' });
}));

module.exports = router;
