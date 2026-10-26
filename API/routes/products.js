// Products: CRUD, server-side search/filter/sort, and the product<->supplier links.
const express = require('express');
const { pool, likeTerm, withTransaction } = require('../db');
const { HttpError, validator, idParam, wrap } = require('../lib/validate');

const router = express.Router();

const SELECT = `SELECT p.*, c.name AS category_name,
                       (p.stock_qty < p.reorder_level) AS is_low_stock
                FROM product p JOIN category c ON c.category_id = p.category_id`;

// whitelist of sort keys -> ORDER BY (never interpolate user input directly)
const SORTS = {
  name_asc: 'p.name ASC',
  name_desc: 'p.name DESC',
  price_asc: 'p.price ASC, p.name',
  price_desc: 'p.price DESC, p.name',
  stock_asc: 'p.stock_qty ASC, p.name',
  stock_desc: 'p.stock_qty DESC, p.name',
  category: 'c.name ASC, p.name ASC',
};

// GET /api/products?q=&category_id=&min_price=&max_price=&in_stock=1&low_stock=1&sort=
router.get('/', wrap(async (req, res) => {
  const { q, category_id, min_price, max_price, in_stock, low_stock, sort } = req.query;
  const where = [];
  const params = [];
  if (q && q.trim()) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.description LIKE ?)');
    const t = likeTerm(q.trim());
    params.push(t, t, t);
  }
  if (category_id) { where.push('p.category_id = ?'); params.push(idParam(category_id)); }
  if (min_price !== undefined && min_price !== '') {
    if (!Number.isFinite(Number(min_price))) throw new HttpError(400, 'min_price must be a number');
    where.push('p.price >= ?'); params.push(Number(min_price));
  }
  if (max_price !== undefined && max_price !== '') {
    if (!Number.isFinite(Number(max_price))) throw new HttpError(400, 'max_price must be a number');
    where.push('p.price <= ?'); params.push(Number(max_price));
  }
  if (in_stock === '1' || in_stock === 'true') where.push('p.stock_qty > 0');
  if (low_stock === '1' || low_stock === 'true') where.push('p.stock_qty < p.reorder_level');
  const order = SORTS[sort] || SORTS.name_asc;
  const sql = `${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  const [rows] = await pool.execute(sql, params);
  res.json(rows);
}));

async function readOne(id, conn = pool) {
  const [rows] = await conn.execute(`${SELECT} WHERE p.product_id = ?`, [id]);
  if (!rows[0]) return null;
  const [sups] = await conn.execute(
    `SELECT ps.supplier_id, s.name AS supplier_name, ps.unit_cost
     FROM product_supplier ps JOIN supplier s ON s.supplier_id = ps.supplier_id
     WHERE ps.product_id = ? ORDER BY s.name`, [id]);
  return { ...rows[0], suppliers: sups };
}

function validate(body) {
  const v = validator(body)
    .str('sku', { required: true, max: 20, label: 'SKU' })
    .str('name', { required: true, max: 120 })
    .str('description', { max: 255 })
    .int('category_id', { required: true, min: 1, label: 'category' })
    .num('price', { required: true, gt: 0 })
    .num('cost', { required: true, min: 0 })
    .int('stock_qty', { min: 0, default: 0, label: 'stock quantity' })
    .int('reorder_level', { min: 0, default: 10, label: 'reorder level' });
  const data = v.done();

  // optional supplier links: [{supplier_id, unit_cost}]
  let links = null;
  if (body.suppliers !== undefined) {
    if (!Array.isArray(body.suppliers)) throw new HttpError(400, 'suppliers must be a list');
    const seen = new Set();
    links = body.suppliers.map(s => {
      const lv = validator(s).int('supplier_id', { required: true, min: 1 }).num('unit_cost', { required: true, min: 0, label: 'supplier unit cost' }).done();
      if (seen.has(lv.supplier_id)) throw new HttpError(400, 'A supplier can only be listed once per product');
      seen.add(lv.supplier_id);
      return lv;
    });
  }
  return { data, links };
}

async function saveLinks(conn, productId, links) {
  if (links === null) return;
  await conn.execute('DELETE FROM product_supplier WHERE product_id = ?', [productId]);
  for (const l of links) {
    await conn.execute('INSERT INTO product_supplier (product_id, supplier_id, unit_cost) VALUES (?, ?, ?)',
      [productId, l.supplier_id, l.unit_cost]);
  }
}

router.get('/:id', wrap(async (req, res) => {
  const p = await readOne(idParam(req.params.id));
  if (!p) throw new HttpError(404, 'Product not found');
  res.json(p);
}));

router.post('/', wrap(async (req, res) => {
  const { data, links } = validate(req.body);
  const id = await withTransaction(async conn => {
    const cols = Object.keys(data);
    const [r] = await conn.execute(
      `INSERT INTO product (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map(c => data[c]));
    await saveLinks(conn, r.insertId, links);
    return r.insertId;
  });
  res.status(201).json(await readOne(id));
}));

router.put('/:id', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  if (!(await readOne(id))) throw new HttpError(404, 'Product not found');
  const { data, links } = validate(req.body);
  await withTransaction(async conn => {
    const cols = Object.keys(data);
    await conn.execute(`UPDATE product SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE product_id = ?`,
      [...cols.map(c => data[c]), id]);
    await saveLinks(conn, id, links);
  });
  res.json(await readOne(id));
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  if (!(await readOne(id))) throw new HttpError(404, 'Product not found');
  try {
    await pool.execute('DELETE FROM product WHERE product_id = ?', [id]); // product_supplier rows cascade
  } catch (err) {
    if (err.errno === 1451) {
      throw new HttpError(409, 'This product appears on past orders or purchases and cannot be deleted. Set its stock to 0 instead.');
    }
    throw err;
  }
  res.json({ message: 'Product deleted' });
}));

module.exports = router;
