// Generates Database/seed.sql deterministically (seeded RNG) so order totals,
// purchase totals and line items are consistent by construction.
//   node Database/tools/generate-seed.js
const fs = require('fs');
const path = require('path');

// --- tiny seeded RNG (mulberry32) so re-generating gives identical data -------
let seed = 330;
function rnd() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = arr => arr[ri(0, arr.length - 1)];
const q = s => (s == null ? 'NULL' : "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'");
const money = n => n.toFixed(2);
const pad = n => String(n).padStart(2, '0');
const fmtDT = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const fmtD = d => fmtDT(d).slice(0, 10);

// --- reference data -----------------------------------------------------------
const categories = [
  ['Indoor Plants', 'Houseplants for homes and offices'],
  ['Outdoor Plants', 'Shrubs, trees and perennials for the yard'],
  ['Flowers', 'Annuals, perennials and cut-flower plants'],
  ['Pots & Planters', 'Ceramic, terracotta and plastic containers'],
  ['Fertilizers & Soil', 'Plant food, potting mix and soil amendments'],
  ['Garden Tools', 'Hand tools, pruners and watering tools'],
  ['Supplies', 'Mulch, seeds, labels and other garden supplies'],
];

// name, contact, email, phone, address
const suppliers = [
  ['Sunrise Greenhouses', 'Maria Alvarez', 'orders@sunrisegh.example', '205-555-0111', '120 Greenhouse Rd, Tuscaloosa, AL'],
  ['Evergreen Wholesale Nursery', 'Tom Bradley', 'sales@evergreenwn.example', '205-555-0122', '88 Pine Hollow Ln, Northport, AL'],
  ['Bloom & Petal Growers', 'Priya Nair', 'hello@bloompetal.example', '334-555-0133', '45 Meadow Way, Montgomery, AL'],
  ['TerraCotta Traders', 'Luca Romano', 'info@terracottatraders.example', '404-555-0144', '900 Clay St, Atlanta, GA'],
  ['GrowWell Fertilizer Co', 'Janet Wu', 'accounts@growwell.example', '615-555-0155', '17 Harvest Blvd, Nashville, TN'],
  ['IronLeaf Tool Supply', 'Derek Hall', 'derek@ironleaf.example', '205-555-0166', '310 Forge Ave, Birmingham, AL'],
  ['Southern Garden Distributors', 'Cynthia Moore', 'cmoore@southerngd.example', '251-555-0177', '5 Harbor Park, Mobile, AL'],
];

// sku, name, category index(1-based), price, cost, reorder, stock, primary supplier index(1-based)
const P = [
  ['IND-001', 'Monstera Deliciosa 8" Pot', 1, 34.99, 16.00, 8, 22, 1],
  ['IND-002', 'Snake Plant Laurentii 6" Pot', 1, 19.99, 8.50, 10, 35, 1],
  ['IND-003', 'Pothos Golden 4" Pot', 1, 9.99, 3.80, 15, 60, 1],
  ['IND-004', 'Fiddle Leaf Fig 10" Pot', 1, 59.99, 28.00, 5, 3, 1],
  ['IND-005', 'ZZ Plant 6" Pot', 1, 24.99, 10.50, 8, 18, 1],
  ['IND-006', 'Peace Lily 8" Pot', 1, 22.99, 9.75, 8, 4, 1],
  ['IND-007', 'Aloe Vera 4" Pot', 1, 7.99, 2.90, 15, 48, 1],
  ['IND-008', 'Spider Plant 6" Hanging Basket', 1, 16.99, 6.60, 8, 25, 1],
  ['OUT-001', 'Knock Out Rose Shrub 3 gal', 2, 29.99, 13.50, 10, 40, 2],
  ['OUT-002', 'Japanese Maple 5 gal', 2, 89.99, 42.00, 4, 9, 2],
  ['OUT-003', 'Boxwood Green Velvet 3 gal', 2, 27.99, 12.00, 10, 7, 2],
  ['OUT-004', 'Blueberry Bush Climax 3 gal', 2, 24.99, 10.25, 8, 21, 2],
  ['OUT-005', 'Crape Myrtle Natchez 7 gal', 2, 74.99, 35.00, 4, 12, 2],
  ['OUT-006', 'Hydrangea Endless Summer 3 gal', 2, 32.99, 14.40, 8, 28, 2],
  ['OUT-007', 'Southern Magnolia 7 gal', 2, 99.99, 47.50, 3, 6, 2],
  ['FLO-001', 'Petunia Mix 6-pack', 3, 5.99, 2.10, 20, 80, 3],
  ['FLO-002', 'Marigold Orange 4" Pot', 3, 3.99, 1.30, 20, 12, 3],
  ['FLO-003', 'Pansy Assorted 6-pack', 3, 6.49, 2.40, 20, 55, 3],
  ['FLO-004', 'Lavender Hidcote 1 gal', 3, 14.99, 6.00, 10, 30, 3],
  ['FLO-005', 'Sunflower Giant 1 gal', 3, 8.99, 3.25, 10, 26, 3],
  ['FLO-006', 'Geranium Red 6" Pot', 3, 11.99, 4.70, 12, 9, 3],
  ['POT-001', 'Terracotta Pot 6"', 4, 6.99, 2.60, 20, 70, 4],
  ['POT-002', 'Terracotta Pot 12"', 4, 18.99, 8.10, 12, 33, 4],
  ['POT-003', 'Glazed Ceramic Planter Blue 10"', 4, 29.99, 13.00, 8, 15, 4],
  ['POT-004', 'Plastic Nursery Pot 1 gal (10-pack)', 4, 12.99, 5.20, 10, 45, 4],
  ['POT-005', 'Hanging Basket Coco Liner 12"', 4, 14.99, 6.10, 8, 5, 4],
  ['POT-006', 'Self-Watering Planter White 8"', 4, 24.99, 10.80, 8, 19, 4],
  ['FER-001', 'All-Purpose Plant Food 5 lb', 5, 15.99, 7.00, 12, 38, 5],
  ['FER-002', 'Organic Potting Mix 2 cu ft', 5, 13.99, 5.80, 15, 50, 5],
  ['FER-003', 'Succulent & Cactus Soil 8 qt', 5, 9.99, 3.90, 12, 14, 5],
  ['FER-004', 'Rose Fertilizer Slow Release 4 lb', 5, 14.49, 6.20, 10, 8, 5],
  ['FER-005', 'Compost Premium 1 cu ft', 5, 7.99, 3.00, 15, 62, 5],
  ['FER-006', 'Liquid Houseplant Food 8 oz', 5, 8.49, 3.10, 12, 27, 5],
  ['TOL-001', 'Bypass Hand Pruners', 6, 21.99, 9.50, 6, 24, 6],
  ['TOL-002', 'Garden Trowel Stainless', 6, 12.99, 5.00, 8, 31, 6],
  ['TOL-003', 'Watering Can 2 gal Galvanized', 6, 27.99, 12.50, 5, 2, 6],
  ['TOL-004', 'Garden Hose 50 ft', 6, 34.99, 15.00, 6, 17, 6],
  ['TOL-005', 'Leather Gardening Gloves', 6, 14.99, 5.80, 10, 36, 6],
  ['TOL-006', 'Loppers 24" Bypass', 6, 39.99, 18.00, 4, 11, 6],
  ['SUP-001', 'Pine Bark Mulch 2 cu ft', 7, 6.49, 2.50, 20, 90, 7],
  ['SUP-002', 'Vegetable Seed Pack Assorted', 7, 2.99, 0.90, 25, 120, 7],
  ['SUP-003', 'Plant Labels 50-pack', 7, 4.49, 1.40, 15, 7, 7],
  ['SUP-004', 'Landscape Fabric 3x50 ft', 7, 19.99, 8.60, 6, 13, 7],
  ['SUP-005', 'Plant Stakes Bamboo 25-pack', 7, 9.49, 3.70, 10, 29, 7],
  ['SUP-006', 'Neem Oil Pest Spray 16 oz', 7, 12.49, 5.10, 8, 20, 7],
  ['SUP-007', 'Moss Pole 24"', 7, 11.99, 4.80, 8, 16, 7],
  ['SUP-008', 'Drip Irrigation Starter Kit', 7, 29.99, 13.60, 5, 10, 7],
];

const customers = [
  ['Olivia', 'Bennett', 'olivia.bennett@example.com', '205-555-0201', '14 Magnolia Dr, Tuscaloosa, AL'],
  ['Noah', 'Carter', 'noah.carter@example.com', '205-555-0202', '202 Elm St, Tuscaloosa, AL'],
  ['Emma', 'Diaz', 'emma.diaz@example.com', '205-555-0203', '7 Lakeview Ct, Northport, AL'],
  ['Liam', 'Edwards', 'liam.edwards@example.com', '205-555-0204', '55 Oak Ridge Rd, Tuscaloosa, AL'],
  ['Ava', 'Foster', 'ava.foster@example.com', '205-555-0205', '310 University Blvd, Tuscaloosa, AL'],
  ['Mason', 'Grant', 'mason.grant@example.com', '205-555-0206', '98 Cedar Ln, Northport, AL'],
  ['Sophia', 'Hughes', 'sophia.hughes@example.com', '205-555-0207', '41 Willow Way, Tuscaloosa, AL'],
  ['Ethan', 'Ingram', 'ethan.ingram@example.com', '205-555-0208', '603 Riverbend Dr, Tuscaloosa, AL'],
  ['Isabella', 'James', 'isabella.james@example.com', '205-555-0209', '12 Birch St, Cottondale, AL'],
  ['Logan', 'Kim', 'logan.kim@example.com', '205-555-0210', '77 Hillcrest Ave, Tuscaloosa, AL'],
  ['Mia', 'Lopez', 'mia.lopez@example.com', '205-555-0211', '230 Pine St, Northport, AL'],
  ['Lucas', 'Murphy', 'lucas.murphy@example.com', '205-555-0212', '19 Sycamore Ct, Tuscaloosa, AL'],
  ['Charlotte', 'Nguyen', 'charlotte.nguyen@example.com', '205-555-0213', '88 Garden Park Dr, Tuscaloosa, AL'],
  ['Henry', 'Ortiz', 'henry.ortiz@example.com', '205-555-0214', '5 Maple Ave, Brookwood, AL'],
  ['Amelia', 'Patel', 'amelia.patel@example.com', '205-555-0215', '144 Jasmine Ln, Tuscaloosa, AL'],
  ['Jack', 'Quinn', 'jack.quinn@example.com', '205-555-0216', '31 Dogwood Dr, Northport, AL'],
  ['Harper', 'Reed', 'harper.reed@example.com', '205-555-0217', '260 Azalea Way, Tuscaloosa, AL'],
  ['Daniel', 'Shaw', 'daniel.shaw@example.com', '205-555-0218', '9 Fernwood Rd, Tuscaloosa, AL'],
];

// first, last, email, role, hire date
const employees = [
  ['Rachel', 'Turner', 'rachel.turner@greenleaf.example', 'Manager', '2021-03-15'],
  ['Marcus', 'Webb', 'marcus.webb@greenleaf.example', 'Employee', '2022-05-02'],
  ['Hannah', 'Young', 'hannah.young@greenleaf.example', 'Employee', '2023-02-20'],
  ['Victor', 'Zimmerman', 'victor.zimmerman@greenleaf.example', 'Employee', '2024-04-08'],
  ['Elena', 'Park', 'elena.park@greenleaf.example', 'Manager', '2020-09-01'],
];

// --- derived data -------------------------------------------------------------
const products = P.map((p, i) => ({
  id: i + 1, sku: p[0], name: p[1], cat: p[2], price: p[3], cost: p[4], reorder: p[5], stock: p[6], sup: p[7],
}));

// product_supplier: primary supplier at list cost; supplier 7 (general distributor)
// is an alternate for everything at +8%; indoor/flower items also from a 2nd specialist.
const psRows = [];
for (const p of products) {
  psRows.push([p.id, p.sup, p.cost]);
  if (p.sup !== 7) psRows.push([p.id, 7, +(p.cost * 1.08).toFixed(2)]);
}
const suppliersOf = pid => psRows.filter(r => r[0] === pid);

// Seasonal weights: spring (Mar-May) is the busiest planting season.
const months = [ // [year, month(0-based), orders]
  [2026, 2, 5], [2026, 3, 7], [2026, 4, 8], [2026, 5, 4], [2026, 6, 3], [2026, 7, 3], [2026, 8, 4], [2026, 9, 6],
];
const orders = [];
for (const [y, m, n] of months) {
  for (let i = 0; i < n; i++) {
    const day = ri(1, m === 9 ? 24 : 28);
    orders.push({ date: new Date(y, m, day, ri(9, 17), ri(0, 59)) });
  }
}
orders.sort((a, b) => a.date - b.date);
const now = new Date(2026, 9, 26);
orders.forEach((o, i) => {
  o.id = i + 1;
  o.customer = ri(1, customers.length);
  o.employee = ri(1, 4);
  const age = (now - o.date) / 86400000;
  o.status = age > 14 ? 'Completed' : pick(['Pending', 'Processing', 'Completed']);
  if (i === 7 || i === 19 || i === 31) o.status = 'Cancelled';
  const n = ri(2, 5);
  const chosen = new Set();
  while (chosen.size < n) chosen.add(ri(1, products.length));
  o.items = [...chosen].map(pid => {
    const prod = products[pid - 1];
    const cheap = prod.price < 10;
    return { pid, qty: cheap ? ri(2, 8) : ri(1, 3), price: prod.price };
  });
  o.total = o.items.reduce((s, it) => s + it.qty * it.price, 0);
});

// Purchases: [supplierIdx, date, status, employee]
const purchaseSpecs = [
  [1, '2026-02-10', 'Received', 5], [2, '2026-02-18', 'Received', 5], [3, '2026-03-05', 'Received', 1],
  [4, '2026-03-12', 'Received', 5], [5, '2026-04-02', 'Received', 1], [6, '2026-04-15', 'Received', 5],
  [1, '2026-05-06', 'Received', 1], [7, '2026-06-10', 'Received', 5], [2, '2026-07-21', 'Received', 1],
  [5, '2026-08-12', 'Received', 5], [4, '2026-09-09', 'Received', 1], [1, '2026-10-14', 'Ordered', 5],
  [3, '2026-10-20', 'Ordered', 1], [6, '2026-09-25', 'Cancelled', 5],
];
const purchases = purchaseSpecs.map((s, i) => {
  const [sid, date, status, emp] = s;
  const pool = products.filter(p => suppliersOf(p.id).some(r => r[1] === sid));
  const n = Math.min(pool.length, ri(3, 6));
  const chosen = new Set();
  while (chosen.size < n) chosen.add(pick(pool).id);
  const items = [...chosen].map(pid => {
    const cost = suppliersOf(pid).find(r => r[1] === sid)[2];
    return { pid, qty: ri(2, 6) * 5, cost };
  });
  const d = new Date(date + 'T12:00:00');
  const received = status === 'Received' ? fmtD(new Date(d.getTime() + 4 * 86400000)) : null;
  return { id: i + 1, sid, date, received, status, emp, items, total: items.reduce((s, it) => s + it.qty * it.cost, 0) };
});

// --- emit SQL -----------------------------------------------------------------
const out = [];
out.push('-- GreenLeaf seed data. GENERATED by Database/tools/generate-seed.js - edit the generator, not this file.');
out.push('-- product.stock_qty is the CURRENT on-hand quantity after all seeded orders and receipts.');
out.push('USE greenleaf;', 'SET FOREIGN_KEY_CHECKS = 0;');
for (const t of ['purchase_item', 'purchase', 'order_item', 'customer_order', 'product_supplier', 'product', 'supplier', 'category', 'employee', 'customer']) out.push(`TRUNCATE TABLE ${t};`);
out.push('SET FOREIGN_KEY_CHECKS = 1;', '');

const ins = (table, cols, rows) => {
  out.push(`INSERT INTO ${table} (${cols}) VALUES`);
  out.push(rows.map(r => '  (' + r.join(', ') + ')').join(',\n') + ';', '');
};
ins('category', 'category_id, name, description', categories.map((c, i) => [i + 1, q(c[0]), q(c[1])]));
ins('supplier', 'supplier_id, name, contact_name, email, phone, address', suppliers.map((s, i) => [i + 1, ...s.map(q)]));
ins('product', 'product_id, sku, name, description, category_id, price, cost, stock_qty, reorder_level',
  products.map(p => [p.id, q(p.sku), q(p.name), q(`${categories[p.cat - 1][0]} - ${p.name}`), p.cat, money(p.price), money(p.cost), p.stock, p.reorder]));
ins('product_supplier', 'product_id, supplier_id, unit_cost', psRows.map(r => [r[0], r[1], money(r[2])]));
ins('customer', 'customer_id, first_name, last_name, email, phone, address, created_at',
  customers.map((c, i) => [i + 1, ...c.map(q), q(`2026-0${1 + (i % 3)}-${pad(5 + i)} 10:00:00`)]));
ins('employee', 'employee_id, first_name, last_name, email, role, hire_date', employees.map((e, i) => [i + 1, ...e.map(q)]));
ins('customer_order', 'order_id, customer_id, employee_id, order_date, status, total_amount',
  orders.map(o => [o.id, o.customer, o.employee, q(fmtDT(o.date)), q(o.status), money(o.total)]));
ins('order_item', 'order_id, product_id, quantity, unit_price',
  orders.flatMap(o => o.items.map(it => [o.id, it.pid, it.qty, money(it.price)])));
ins('purchase', 'purchase_id, supplier_id, employee_id, purchase_date, received_date, status, total_cost',
  purchases.map(p => [p.id, p.sid, p.emp, q(p.date), q(p.received), q(p.status), money(p.total)]));
ins('purchase_item', 'purchase_id, product_id, quantity, unit_cost',
  purchases.flatMap(p => p.items.map(it => [p.id, it.pid, it.qty, money(it.cost)])));

const file = path.join(__dirname, '..', 'seed.sql');
fs.writeFileSync(file, out.join('\n'));
console.log(`Wrote ${file}: ${products.length} products, ${orders.length} orders, ${purchases.length} purchases`);
