// Supplier purchases: CRUD plus the stock-receipt TRANSACTION.
//
// Rules
//   * One purchase = one supplier; its lines must be products that supplier sells.
//   * Inventory only increases when a purchase is RECEIVED (Ordered -> Received).
//   * Received purchases are financial/stock history: they cannot be edited,
//     cancelled or deleted.
const express = require('express');
const { pool, placeholders, withTransaction } = require('../db');
const { HttpError, validator, idParam, wrap } = require('../lib/validate');

const router = express.Router();
const STATUSES = ['Ordered', 'Received', 'Cancelled'];

const LIST_SQL = `
  SELECT pu.purchase_id, pu.purchase_date, pu.received_date, pu.status, pu.total_cost,
         pu.supplier_id, s.name AS supplier_name,
         pu.employee_id, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
         (SELECT COALESCE(SUM(pi.quantity), 0) FROM purchase_item pi WHERE pi.purchase_id = pu.purchase_id) AS unit_count
  FROM purchase pu
  JOIN supplier s ON s.supplier_id = pu.supplier_id
  JOIN employee e ON e.employee_id = pu.employee_id`;

router.get('/', wrap(async (req, res) => {
  const { status, supplier_id, from, to } = req.query;
  const where = [];
  const params = [];
  if (status) {
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status filter');
    where.push('pu.status = ?'); params.push(status);
  }
  if (supplier_id) { where.push('pu.supplier_id = ?'); params.push(idParam(supplier_id)); }
  for (const [val, col, op] of [[from, 'from', '>='], [to, 'to', '<=']]) {
    if (val) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) throw new HttpError(400, `${col} must be a date (YYYY-MM-DD)`);
      where.push(`pu.purchase_date ${op} ?`); params.push(val);
    }
  }
  const sql = `${LIST_SQL}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY pu.purchase_date DESC, pu.purchase_id DESC`;
  const [rows] = await pool.execute(sql, params);
  res.json(rows);
}));

async function readOne(id, conn = pool) {
  const [rows] = await conn.execute(`${LIST_SQL} WHERE pu.purchase_id = ?`, [id]);
  if (!rows[0]) return null;
  const [items] = await conn.execute(
    `SELECT pi.purchase_item_id, pi.product_id, p.sku, p.name AS product_name, pi.quantity, pi.unit_cost,
            pi.quantity * pi.unit_cost AS line_total
     FROM purchase_item pi JOIN product p ON p.product_id = pi.product_id
     WHERE pi.purchase_id = ? ORDER BY p.name`, [id]);
  return { ...rows[0], items };
}

router.get('/:id', wrap(async (req, res) => {
  const p = await readOne(idParam(req.params.id));
  if (!p) throw new HttpError(404, 'Purchase not found');
  res.json(p);
}));

// Validate the request body shared by create and update
function validateBody(body) {
  const head = validator(body)
    .int('supplier_id', { required: true, min: 1, label: 'supplier' })
    .int('employee_id', { required: true, min: 1, label: 'employee' })
    .date('purchase_date')
    .done();
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, 'A purchase needs at least one item');
  if (body.items.length > 50) throw new HttpError(400, 'A purchase can have at most 50 line items');
  const seen = new Set();
  const items = body.items.map(it => {
    const iv = validator(it)
      .int('product_id', { required: true, min: 1 })
      .int('quantity', { required: true, min: 1, max: 100000 })
      .num('unit_cost', { required: true, min: 0, label: 'unit cost' }).done();
    if (seen.has(iv.product_id)) throw new HttpError(400, 'A product can only appear once per purchase');
    seen.add(iv.product_id);
    return iv;
  });
  return { head, items };
}

// Insert the lines and recompute the total; checks the supplier really sells each product
async function saveItems(conn, purchaseId, supplierId, items) {
  const ids = items.map(i => i.product_id);
  const [ok] = await conn.execute(
    `SELECT product_id FROM product_supplier
     WHERE supplier_id = ? AND product_id IN (${placeholders(ids.length)})`, [supplierId, ...ids]);
  const okSet = new Set(ok.map(r => r.product_id));
  const bad = ids.filter(i => !okSet.has(i));
  if (bad.length) throw new HttpError(400, `This supplier does not supply product id(s): ${bad.join(', ')}`);

  await conn.execute('DELETE FROM purchase_item WHERE purchase_id = ?', [purchaseId]);
  for (const it of items) {
    await conn.execute('INSERT INTO purchase_item (purchase_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)',
      [purchaseId, it.product_id, it.quantity, it.unit_cost]);
  }
  await conn.execute(
    `UPDATE purchase SET total_cost =
       (SELECT COALESCE(SUM(quantity * unit_cost), 0) FROM purchase_item WHERE purchase_id = ?)
     WHERE purchase_id = ?`, [purchaseId, purchaseId]);
}

// Receive a purchase: lock purchase + products, add stock, mark Received.
async function receive(conn, purchaseId) {
  const [rows] = await conn.execute('SELECT status FROM purchase WHERE purchase_id = ? FOR UPDATE', [purchaseId]);
  if (!rows[0]) throw new HttpError(404, 'Purchase not found');
  if (rows[0].status !== 'Ordered') throw new HttpError(409, `Only Ordered purchases can be received (this one is ${rows[0].status})`);
  const [items] = await conn.execute(
    'SELECT product_id, quantity FROM purchase_item WHERE purchase_id = ? ORDER BY product_id', [purchaseId]);
  if (!items.length) throw new HttpError(409, 'Purchase has no items');
  // lock products in ascending id order (same order orders.js uses)
  await conn.execute(
    `SELECT product_id FROM product WHERE product_id IN (${placeholders(items.length)}) ORDER BY product_id FOR UPDATE`,
    items.map(i => i.product_id));
  for (const it of items) {
    await conn.execute('UPDATE product SET stock_qty = stock_qty + ? WHERE product_id = ?', [it.quantity, it.product_id]);
  }
  await conn.execute("UPDATE purchase SET status = 'Received', received_date = CURDATE() WHERE purchase_id = ?", [purchaseId]);
}

// POST /api/purchases  { supplier_id, employee_id, purchase_date?, receive_now?, items: [{product_id, quantity, unit_cost}] }
router.post('/', wrap(async (req, res) => {
  const { head, items } = validateBody(req.body);
  const receiveNow = req.body.receive_now === true || req.body.receive_now === 'true';
  const id = await withTransaction(async conn => {
    const [ins] = await conn.execute(
      "INSERT INTO purchase (supplier_id, employee_id, purchase_date, status, total_cost) VALUES (?, ?, COALESCE(?, CURDATE()), 'Ordered', 0)",
      [head.supplier_id, head.employee_id, head.purchase_date]);
    await saveItems(conn, ins.insertId, head.supplier_id, items);
    if (receiveNow) await receive(conn, ins.insertId);
    return ins.insertId;
  });
  res.status(201).json(await readOne(id));
}));

// PUT /api/purchases/:id  (Ordered only) replaces header + lines
router.put('/:id', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const { head, items } = validateBody(req.body);
  await withTransaction(async conn => {
    const [rows] = await conn.execute('SELECT status FROM purchase WHERE purchase_id = ? FOR UPDATE', [id]);
    if (!rows[0]) throw new HttpError(404, 'Purchase not found');
    if (rows[0].status !== 'Ordered') throw new HttpError(409, `A ${rows[0].status} purchase can no longer be edited`);
    await conn.execute(
      'UPDATE purchase SET supplier_id = ?, employee_id = ?, purchase_date = COALESCE(?, purchase_date) WHERE purchase_id = ?',
      [head.supplier_id, head.employee_id, head.purchase_date, id]);
    await saveItems(conn, id, head.supplier_id, items);
  });
  res.json(await readOne(id));
}));

// POST /api/purchases/:id/receive - TRANSACTION that increases inventory
router.post('/:id/receive', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(conn => receive(conn, id));
  res.json(await readOne(id));
}));

// POST /api/purchases/:id/cancel
router.post('/:id/cancel', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async conn => {
    const [rows] = await conn.execute('SELECT status FROM purchase WHERE purchase_id = ? FOR UPDATE', [id]);
    if (!rows[0]) throw new HttpError(404, 'Purchase not found');
    if (rows[0].status !== 'Ordered') throw new HttpError(409, `Only Ordered purchases can be cancelled (this one is ${rows[0].status})`);
    await conn.execute("UPDATE purchase SET status = 'Cancelled' WHERE purchase_id = ?", [id]);
  });
  res.json(await readOne(id));
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const p = await readOne(id);
  if (!p) throw new HttpError(404, 'Purchase not found');
  if (p.status === 'Received') throw new HttpError(409, 'Received purchases changed inventory and are financial records; they cannot be deleted.');
  await pool.execute('DELETE FROM purchase WHERE purchase_id = ?', [id]); // purchase_item cascades
  res.json({ message: 'Purchase deleted' });
}));

// Products a given supplier sells, with their quoted cost (mounted at /api/suppliers)
const supplierProducts = express.Router();
supplierProducts.get('/:id/products', wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.product_id, p.sku, p.name, p.stock_qty, p.reorder_level, ps.unit_cost
     FROM product_supplier ps JOIN product p ON p.product_id = ps.product_id
     WHERE ps.supplier_id = ? ORDER BY p.name`, [idParam(req.params.id)]);
  res.json(rows);
}));

module.exports = { router, supplierProducts };
