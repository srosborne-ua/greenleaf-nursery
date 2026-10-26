// Reports: parses Database/reports.sql (the single source of truth) and runs each query.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { pool } = require('../db');
const { HttpError, wrap } = require('../lib/validate');

const router = express.Router();
const FILE = path.join(__dirname, '..', '..', 'Database', 'reports.sql');

// Each block starts with "-- REPORT n: title" and has QUESTION/EXPLAIN comments + one statement.
function loadReports() {
  const text = fs.readFileSync(FILE, 'utf8');
  return text.split(/^-- REPORT /m).slice(1).map(block => {
    const lines = block.split('\n');
    const [, id, title] = lines[0].match(/^(\d+):\s*(.*)$/);
    const grab = tag => {
      const l = lines.find(x => x.startsWith(`-- ${tag}:`));
      return l ? l.slice(tag.length + 4).trim() : '';
    };
    const sql = lines.slice(1).filter(l => !l.trim().startsWith('--')).join('\n').trim().replace(/;\s*$/, '');
    return { id: Number(id), title: title.trim(), question: grab('QUESTION'), explanation: grab('EXPLAIN'), sql };
  });
}

async function run(report) {
  const [rows] = await pool.execute(report.sql);
  return { ...report, rows };
}

router.get('/', wrap(async (req, res) => {
  res.json(await Promise.all(loadReports().map(run)));
}));

router.get('/:id', wrap(async (req, res) => {
  const report = loadReports().find(r => r.id === Number(req.params.id));
  if (!report) throw new HttpError(404, 'Report not found (valid ids: 1-5)');
  res.json(await run(report));
}));

module.exports = router;
