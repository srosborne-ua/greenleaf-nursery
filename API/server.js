// GreenLeaf API + static client. `npm start` serves everything on one port.
require('dotenv').config();
const path = require('path');
const express = require('express');
const { pool } = require('./db');
const { HttpError } = require('./lib/validate');
const simple = require('./routes/simple');
const purchases = require('./routes/purchases');

const app = express();
app.use(express.json({ limit: '200kb' }));

app.use('/api/categories', simple.category);
app.use('/api/suppliers', purchases.supplierProducts, simple.supplier);
app.use('/api/customers', simple.customer);
app.use('/api/employees', simple.employee);
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/purchases', purchases.router);
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/reports', require('./routes/reports'));
app.get('/api/health', async (req, res, next) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); } catch (e) { next(e); }
});
app.use('/api', (req, res, next) => next(new HttpError(404, 'Unknown API endpoint')));

// Front end: Project/Client (single page)
app.use(express.static(path.join(__dirname, '..', 'Client')));

// Central error handler: translate MySQL errors into friendly JSON
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  switch (err.errno) {
    case 1062: return res.status(409).json({ error: duplicateMessage(err) });
    case 1451: return res.status(409).json({ error: 'This record is referenced by other records and cannot be deleted.' });
    case 1452: return res.status(400).json({ error: 'A referenced record (category, supplier, customer, employee or product) does not exist.' });
    case 3819: return res.status(400).json({ error: 'A value violates a database rule (e.g. price must be > 0, quantity >= 0).' });
    default:
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
  }
});

function duplicateMessage(err) {
  const m = /for key '(?:\w+\.)?(\w+)'/.exec(err.sqlMessage || '');
  const key = m ? m[1] : '';
  if (key.includes('email')) return 'That email address is already in use.';
  if (key.includes('sku')) return 'That SKU is already used by another product.';
  if (key.includes('name')) return 'That name already exists.';
  return 'A record with the same unique value already exists.';
}

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(port, () => console.log(`GreenLeaf running at http://localhost:${port}`));
}
module.exports = app;
