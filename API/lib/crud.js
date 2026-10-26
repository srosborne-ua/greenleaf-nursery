// Generic CRUD router used by the simple entities (category, supplier, customer,
// employee). Products, orders and purchases have bespoke routers because of
// their joins and transactions.
const express = require('express');
const { pool, likeTerm } = require('../db');
const { HttpError, idParam, wrap } = require('./validate');

/**
 * cfg.table      table name (used for INSERT/UPDATE/DELETE)
 * cfg.pk         primary-key column
 * cfg.name       singular label for messages ("category")
 * cfg.select     SELECT ... FROM ... <alias> (no WHERE) used for reads
 * cfg.alias      table alias used in cfg.select
 * cfg.search     columns (alias-qualified) matched by ?q=
 * cfg.orderBy    ORDER BY expression for lists
 * cfg.validate   (body) => object of column -> value (throws HttpError 400)
 * cfg.inUse      friendly message when a delete is blocked by foreign keys
 */
function crudRouter(cfg) {
  const router = express.Router();

  const readOne = async id => {
    const [rows] = await pool.execute(`${cfg.select} WHERE ${cfg.alias}.${cfg.pk} = ?`, [id]);
    return rows[0];
  };

  router.get('/', wrap(async (req, res) => {
    const params = [];
    let where = '';
    const q = (req.query.q || '').trim();
    if (q) {
      where = ' WHERE (' + cfg.search.map(c => `${c} LIKE ?`).join(' OR ') + ')';
      cfg.search.forEach(() => params.push(likeTerm(q)));
    }
    const [rows] = await pool.execute(`${cfg.select}${where} ORDER BY ${cfg.orderBy}`, params);
    res.json(rows);
  }));

  router.get('/:id', wrap(async (req, res) => {
    const row = await readOne(idParam(req.params.id));
    if (!row) throw new HttpError(404, `${cfg.name} not found`);
    res.json(row);
  }));

  router.post('/', wrap(async (req, res) => {
    const data = cfg.validate(req.body);
    const cols = Object.keys(data);
    const [result] = await pool.execute(
      `INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map(c => data[c]));
    res.status(201).json(await readOne(result.insertId));
  }));

  router.put('/:id', wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!(await readOne(id))) throw new HttpError(404, `${cfg.name} not found`);
    const data = cfg.validate(req.body);
    const cols = Object.keys(data);
    await pool.execute(
      `UPDATE ${cfg.table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE ${cfg.pk} = ?`,
      [...cols.map(c => data[c]), id]);
    res.json(await readOne(id));
  }));

  router.delete('/:id', wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!(await readOne(id))) throw new HttpError(404, `${cfg.name} not found`);
    try {
      await pool.execute(`DELETE FROM ${cfg.table} WHERE ${cfg.pk} = ?`, [id]);
    } catch (err) {
      if (err.errno === 1451) throw new HttpError(409, cfg.inUse);
      throw err;
    }
    res.json({ message: `${cfg.name} deleted` });
  }));

  return router;
}

module.exports = { crudRouter };
