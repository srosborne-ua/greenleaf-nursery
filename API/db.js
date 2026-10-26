// MySQL connection pool + helpers. Every query in the API goes through
// pool.execute() (true server-side prepared statements) with ? placeholders.
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'greenleaf',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true, // return DECIMAL columns as numbers, not strings
  dateStrings: true,    // return DATE/DATETIME as strings (no timezone shifting)
});

// "?,?,?" placeholder list for IN (...) clauses
const placeholders = n => Array(n).fill('?').join(',');

// Escape LIKE wildcards in user-supplied search text
const likeTerm = s => '%' + String(s).replace(/[\\%_]/g, '\\$&') + '%';

/**
 * Run fn(conn) inside a real MySQL transaction: BEGIN ... COMMIT, or ROLLBACK
 * (and rethrow) if fn throws. The connection is always released.
 */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, placeholders, likeTerm, withTransaction };
