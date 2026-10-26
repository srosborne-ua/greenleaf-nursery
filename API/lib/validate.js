// Small request-validation helper + HttpError. Collects every problem so the
// client can show them all at once instead of one at a time.
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validator(body) {
  body = body && typeof body === 'object' ? body : {};
  const out = {};
  const errors = [];
  const blank = k => body[k] === undefined || body[k] === null || String(body[k]).trim() === '';
  const label = (k, o) => (o && o.label) || k.replace(/_/g, ' ');

  const v = {
    out,
    str(k, o = {}) {
      if (blank(k)) {
        if (o.required) errors.push(`${label(k, o)} is required`);
        out[k] = null;
        return v;
      }
      const s = String(body[k]).trim();
      if (s.length > (o.max || 255)) errors.push(`${label(k, o)} must be at most ${o.max || 255} characters`);
      out[k] = s;
      return v;
    },
    email(k, o = {}) {
      v.str(k, o);
      if (out[k] && !EMAIL.test(out[k])) errors.push(`${label(k, o)} must be a valid email address`);
      return v;
    },
    int(k, o = {}) {
      if (blank(k)) {
        if (o.required) errors.push(`${label(k, o)} is required`);
        out[k] = o.default !== undefined ? o.default : null;
        return v;
      }
      const n = Number(body[k]);
      if (!Number.isInteger(n)) errors.push(`${label(k, o)} must be a whole number`);
      else if (o.min !== undefined && n < o.min) errors.push(`${label(k, o)} must be at least ${o.min}`);
      else if (o.max !== undefined && n > o.max) errors.push(`${label(k, o)} must be at most ${o.max}`);
      out[k] = n;
      return v;
    },
    // money / decimal: min is inclusive unless gt is given (strictly greater than)
    num(k, o = {}) {
      if (blank(k)) {
        if (o.required) errors.push(`${label(k, o)} is required`);
        out[k] = null;
        return v;
      }
      const n = Number(body[k]);
      if (!Number.isFinite(n)) errors.push(`${label(k, o)} must be a number`);
      else if (o.gt !== undefined && !(n > o.gt)) errors.push(`${label(k, o)} must be greater than ${o.gt}`);
      else if (o.min !== undefined && n < o.min) errors.push(`${label(k, o)} must be at least ${o.min}`);
      else if (n > 99999999) errors.push(`${label(k, o)} is too large`);
      out[k] = Math.round(n * 100) / 100;
      return v;
    },
    oneOf(k, values, o = {}) {
      if (blank(k)) {
        if (o.required) errors.push(`${label(k, o)} is required`);
        out[k] = o.default !== undefined ? o.default : null;
        return v;
      }
      if (!values.includes(body[k])) errors.push(`${label(k, o)} must be one of: ${values.join(', ')}`);
      out[k] = body[k];
      return v;
    },
    date(k, o = {}) {
      if (blank(k)) {
        if (o.required) errors.push(`${label(k, o)} is required`);
        out[k] = null;
        return v;
      }
      const s = String(body[k]).slice(0, 10);
      if (!DATE.test(s) || Number.isNaN(Date.parse(s))) errors.push(`${label(k, o)} must be a date (YYYY-MM-DD)`);
      out[k] = s;
      return v;
    },
    error(msg) { errors.push(msg); return v; },
    done() {
      if (errors.length) throw new HttpError(400, 'Validation failed: ' + errors.join('; '), errors);
      return out;
    },
  };
  return v;
}

// Parse and check a numeric :id route param
function idParam(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Invalid id');
  return n;
}

// Wrap async route handlers so rejected promises reach the error middleware
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, validator, idParam, wrap };
