// Inventory view: current stock with low-stock flags and stock value.
const express = require('express');
const { pool, likeTerm } = require('../db');
const { wrap } = require('../lib/validate');

const router = express.Router();

// GET /api/inventory?q=&category_id=&low_stock=1
router.get('/', wrap(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.q && req.query.q.trim()) {
    where.push('(p.name LIKE ? OR p.sku LIKE ?)');
    params.push(likeTerm(req.query.q.trim()), likeTerm(req.query.q.trim()));
  }
  if (req.query.category_id) { where.push('p.category_id = ?'); params.push(Number(req.query.category_id) || 0); }
  if (req.query.low_stock === '1') where.push('p.stock_qty < p.reorder_level');
  const [rows] = await pool.execute(
    `SELECT p.product_id, p.sku, p.name, c.name AS category_name, p.stock_qty, p.reorder_level,
            p.cost, p.price, p.stock_qty * p.cost AS stock_value,
            CASE WHEN p.stock_qty = 0 THEN 'Out of stock'
                 WHEN p.stock_qty < p.reorder_level THEN 'Low'
                 ELSE 'OK' END AS stock_status,
            -- units on open (Ordered) supplier purchases
            (SELECT COALESCE(SUM(pi.quantity), 0) FROM purchase_item pi
               JOIN purchase pu ON pu.purchase_id = pi.purchase_id
              WHERE pi.product_id = p.product_id AND pu.status = 'Ordered') AS on_order
     FROM product p JOIN category c ON c.category_id = p.category_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (p.stock_qty < p.reorder_level) DESC, p.stock_qty - p.reorder_level, p.name`, params);
  const summary = {
    products: rows.length,
    low_stock: rows.filter(r => r.stock_status !== 'OK').length,
    total_units: rows.reduce((s, r) => s + r.stock_qty, 0),
    stock_value: Math.round(rows.reduce((s, r) => s + r.stock_value, 0) * 100) / 100,
  };
  res.json({ summary, items: rows });
}));

module.exports = router;
