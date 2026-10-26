// End-to-end API test. Requires the server running and a freshly seeded DB:
//   node test/api-test.js [baseUrl]      (default http://localhost:3000)
// Uses Node 18+'s built-in fetch; no test framework needed.
const BASE = process.argv[2] || 'http://localhost:3000';
let passed = 0;
let failed = 0;

async function call(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, data };
}
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${extra ? '  -> ' + JSON.stringify(extra) : ''}`); }
}
const section = s => console.log(`\n# ${s}`);

(async () => {
  const stamp = Date.now();

  section('Categories CRUD');
  let r = await call('POST', '/api/categories', { name: 'Test Cat ' + stamp, description: 'temp' });
  check('create category -> 201', r.status === 201, r);
  const catId = r.data.category_id;
  r = await call('POST', '/api/categories', { name: 'Test Cat ' + stamp });
  check('duplicate category name -> 409', r.status === 409, r);
  r = await call('POST', '/api/categories', { name: '' });
  check('blank category name -> 400', r.status === 400, r);
  r = await call('PUT', `/api/categories/${catId}`, { name: 'Test Cat B ' + stamp, description: 'edited' });
  check('update category', r.status === 200 && r.data.description === 'edited', r);
  r = await call('GET', `/api/categories?q=${encodeURIComponent('Test Cat B')}`);
  check('search categories', r.data.length === 1, r);

  section('Suppliers CRUD');
  r = await call('POST', '/api/suppliers', { name: 'Test Supplier ' + stamp, email: 'bad-email' });
  check('invalid supplier email -> 400', r.status === 400, r);
  r = await call('POST', '/api/suppliers', { name: 'Test Supplier ' + stamp, email: `s${stamp}@x.com`, phone: '555-1212' });
  check('create supplier', r.status === 201, r);
  const supId = r.data.supplier_id;

  section('Products CRUD + validation');
  r = await call('POST', '/api/products', { sku: 'T-' + stamp, name: 'Bad', category_id: catId, price: 0, cost: 1, stock_qty: 1 });
  check('price 0 -> 400', r.status === 400, r);
  r = await call('POST', '/api/products', { sku: 'T-' + stamp, name: 'Bad', category_id: catId, price: 5, cost: 1, stock_qty: -3 });
  check('negative stock -> 400', r.status === 400, r);
  r = await call('POST', '/api/products', { sku: 'T-' + stamp, name: 'Bad', category_id: 99999, price: 5, cost: 1, stock_qty: 1 });
  check('unknown category -> 400', r.status === 400, r);
  r = await call('POST', '/api/products', {
    sku: 'T-' + stamp, name: 'Test Fern', category_id: catId, price: 12.5, cost: 5, stock_qty: 5, reorder_level: 3,
    suppliers: [{ supplier_id: supId, unit_cost: 5.25 }],
  });
  check('create product with supplier link', r.status === 201 && r.data.suppliers.length === 1, r);
  const prodId = r.data.product_id;
  r = await call('POST', '/api/products', { sku: 'T-' + stamp, name: 'Dup', category_id: catId, price: 5, cost: 1 });
  check('duplicate SKU -> 409', r.status === 409, r);
  r = await call('PUT', `/api/products/${prodId}`, { sku: 'T-' + stamp, name: 'Test Fern 2', category_id: catId, price: 13, cost: 5, stock_qty: 5, reorder_level: 3 });
  check('update product', r.status === 200 && r.data.price === 13, r);
  r = await call('DELETE', `/api/categories/${catId}`);
  check('delete category with products -> 409 friendly', r.status === 409 && /products/i.test(r.data.error), r);

  section('Product search / filter / sort');
  r = await call('GET', '/api/products');
  const all = r.data;
  check('list products (47+)', all.length >= 47, all.length);
  r = await call('GET', '/api/products?q=rose');
  check('keyword filter', r.data.length > 0 && r.data.every(p => /rose/i.test(p.name + p.sku + p.description)), r.data.length);
  r = await call('GET', '/api/products?category_id=4');
  check('category filter', r.data.length > 0 && r.data.every(p => p.category_id === 4));
  r = await call('GET', '/api/products?min_price=20&max_price=30');
  check('price range filter', r.data.length > 0 && r.data.every(p => p.price >= 20 && p.price <= 30));
  r = await call('GET', '/api/products?low_stock=1');
  check('low-stock filter', r.data.length >= 9 && r.data.every(p => p.stock_qty < p.reorder_level), r.data.length);
  r = await call('GET', '/api/products?sort=price_desc');
  check('sort price desc', r.data[0].price >= r.data[1].price);
  r = await call('GET', "/api/products?q=' OR 1=1 --");
  check('SQL injection string treated as plain text', r.status === 200 && r.data.length === 0, r.data.length);
  r = await call('GET', '/api/products?sort=name;DROP TABLE product');
  check('malicious sort key ignored', r.status === 200 && r.data.length >= 47);

  section('Customers CRUD + search');
  r = await call('POST', '/api/customers', { first_name: 'Tess', last_name: 'Tester' + stamp, email: `t${stamp}@x.com` });
  check('create customer', r.status === 201, r);
  const custId = r.data.customer_id;
  r = await call('POST', '/api/customers', { first_name: 'Tess', last_name: 'Again', email: `t${stamp}@x.com` });
  check('duplicate email -> 409', r.status === 409 && /email/i.test(r.data.error), r);
  r = await call('GET', `/api/customers?q=Tester${stamp}`);
  check('search customer by name', r.data.length === 1, r);
  r = await call('GET', `/api/customers?q=t${stamp}@x`);
  check('search customer by email', r.data.length === 1, r);
  r = await call('PUT', `/api/customers/${custId}`, { first_name: 'Tessa', last_name: 'Tester' + stamp, email: `t${stamp}@x.com`, phone: '1' });
  check('update customer', r.data.first_name === 'Tessa', r);

  section('Employees');
  r = await call('GET', '/api/employees');
  check('list employees', r.data.length >= 5, r.data.length);
  const empId = r.data[0].employee_id;
  r = await call('POST', '/api/employees', { first_name: 'Temp', last_name: 'Worker', email: `w${stamp}@x.com`, role: 'Employee', hire_date: '2026-01-01' });
  check('create employee', r.status === 201, r);
  r = await call('DELETE', `/api/employees/${r.data.employee_id}`);
  check('delete unused employee', r.status === 200, r);

  section('Order transaction - success');
  const before = (await call('GET', `/api/products/${prodId}`)).data.stock_qty;
  r = await call('POST', '/api/orders', { customer_id: custId, employee_id: empId, items: [{ product_id: prodId, quantity: 2 }] });
  check('place order -> 201', r.status === 201, r);
  const orderId = r.data.order_id;
  check('order total = 2 x 13.00', r.data.total_amount === 26, r.data.total_amount);
  check('status starts Pending', r.data.status === 'Pending');
  let after = (await call('GET', `/api/products/${prodId}`)).data.stock_qty;
  check(`stock decremented ${before} -> ${after}`, after === before - 2);

  section('Order transaction - ROLLBACK on insufficient stock');
  const ordersBefore = (await call('GET', '/api/orders')).data.length;
  const other = all.find(p => p.stock_qty >= 5 && p.product_id !== prodId);
  const otherBefore = other.stock_qty;
  r = await call('POST', '/api/orders', {
    customer_id: custId, employee_id: empId,
    items: [{ product_id: other.product_id, quantity: 1 }, { product_id: prodId, quantity: 999 }],
  });
  check('over-ordering -> 409', r.status === 409 && /insufficient stock/i.test(r.data.error), r);
  check('error lists the short product', r.data.details && r.data.details.shortages[0].product_id === prodId, r.data);
  check('no order row was kept', (await call('GET', '/api/orders')).data.length === ordersBefore);
  check('first item stock NOT decremented (rolled back)', (await call('GET', `/api/products/${other.product_id}`)).data.stock_qty === otherBefore);
  check('short item stock unchanged', (await call('GET', `/api/products/${prodId}`)).data.stock_qty === after);
  r = await call('POST', '/api/orders', { customer_id: custId, employee_id: empId, items: [] });
  check('empty order -> 400', r.status === 400);
  r = await call('POST', '/api/orders', { customer_id: custId, employee_id: empId, items: [{ product_id: prodId, quantity: 0 }] });
  check('quantity 0 -> 400', r.status === 400);
  r = await call('POST', '/api/orders', { customer_id: 99999, employee_id: empId, items: [{ product_id: prodId, quantity: 1 }] });
  check('unknown customer -> 400', r.status === 400);

  section('Order list / filter / status');
  r = await call('GET', `/api/orders?customer_id=${custId}`);
  check('filter orders by customer', r.data.length === 1 && r.data[0].order_id === orderId, r.data);
  r = await call('GET', '/api/orders?status=Cancelled');
  check('filter orders by status', r.data.length >= 3 && r.data.every(o => o.status === 'Cancelled'));
  r = await call('GET', '/api/orders?from=2026-03-01&to=2026-03-31');
  check('filter orders by date range', r.data.length > 0 && r.data.every(o => o.order_date.startsWith('2026-03')), r.data.length);
  r = await call('GET', `/api/orders/${orderId}`);
  check('order detail has line items', r.data.items.length === 1 && r.data.items[0].line_total === 26, r.data);
  r = await call('PATCH', `/api/orders/${orderId}/status`, { status: 'Processing' });
  check('Pending -> Processing', r.status === 200 && r.data.status === 'Processing', r);
  r = await call('PATCH', `/api/orders/${orderId}/status`, { status: 'Bogus' });
  check('invalid status -> 400', r.status === 400);
  r = await call('DELETE', `/api/customers/${custId}`);
  check('delete customer with orders -> 409 friendly', r.status === 409 && /orders/i.test(r.data.error), r);
  r = await call('PATCH', `/api/orders/${orderId}/status`, { status: 'Cancelled' });
  check('cancel order', r.status === 200 && r.data.status === 'Cancelled', r);
  after = (await call('GET', `/api/products/${prodId}`)).data.stock_qty;
  check('cancel restores stock', after === before, after);
  r = await call('PATCH', `/api/orders/${orderId}/status`, { status: 'Pending' });
  check('Cancelled is final -> 409', r.status === 409);
  r = await call('DELETE', `/api/orders/${orderId}`);
  check('delete cancelled order', r.status === 200);
  const completed = (await call('GET', '/api/orders?status=Completed')).data[0];
  r = await call('DELETE', `/api/orders/${completed.order_id}`);
  check('delete Completed order -> 409', r.status === 409);

  section('Purchase transaction - receipt increases stock');
  const pBefore = (await call('GET', `/api/products/${prodId}`)).data.stock_qty;
  r = await call('POST', '/api/purchases', { supplier_id: supId, employee_id: empId, items: [{ product_id: prodId, quantity: 20, unit_cost: 5.25 }] });
  check('create purchase (Ordered)', r.status === 201 && r.data.status === 'Ordered' && r.data.total_cost === 105, r);
  const purId = r.data.purchase_id;
  check('stock unchanged until received', (await call('GET', `/api/products/${prodId}`)).data.stock_qty === pBefore);
  r = await call('POST', '/api/purchases', { supplier_id: 1, employee_id: empId, items: [{ product_id: prodId, quantity: 1, unit_cost: 1 }] });
  check('product not sold by that supplier -> 400', r.status === 400, r);
  r = await call('POST', `/api/purchases/${purId}/receive`);
  check('receive purchase', r.status === 200 && r.data.status === 'Received' && r.data.received_date, r);
  check('stock increased by 20', (await call('GET', `/api/products/${prodId}`)).data.stock_qty === pBefore + 20);
  r = await call('POST', `/api/purchases/${purId}/receive`);
  check('receiving twice -> 409 (no double count)', r.status === 409);
  check('stock still +20 only', (await call('GET', `/api/products/${prodId}`)).data.stock_qty === pBefore + 20);
  r = await call('DELETE', `/api/purchases/${purId}`);
  check('delete Received purchase -> 409', r.status === 409);
  r = await call('POST', '/api/purchases', { supplier_id: supId, employee_id: empId, items: [{ product_id: prodId, quantity: 5, unit_cost: 5 }] });
  const pur2 = r.data.purchase_id;
  r = await call('PUT', `/api/purchases/${pur2}`, { supplier_id: supId, employee_id: empId, items: [{ product_id: prodId, quantity: 7, unit_cost: 5 }] });
  check('edit Ordered purchase', r.status === 200 && r.data.total_cost === 35, r);
  r = await call('POST', `/api/purchases/${pur2}/cancel`);
  check('cancel purchase', r.data.status === 'Cancelled', r);
  r = await call('DELETE', `/api/purchases/${pur2}`);
  check('delete cancelled purchase', r.status === 200);
  r = await call('POST', '/api/purchases', { supplier_id: supId, employee_id: empId, receive_now: true, items: [{ product_id: prodId, quantity: 3, unit_cost: 5 }] });
  check('create + receive in one transaction', r.data.status === 'Received', r);
  check('stock +3 more', (await call('GET', `/api/products/${prodId}`)).data.stock_qty === pBefore + 23);
  r = await call('DELETE', `/api/suppliers/${supId}`);
  check('delete supplier with purchases -> 409 friendly', r.status === 409 && /purchase/i.test(r.data.error), r);
  r = await call('DELETE', `/api/products/${prodId}`);
  check('delete product used in purchases -> 409 friendly', r.status === 409, r);

  section('Inventory');
  r = await call('GET', '/api/inventory');
  check('inventory list + summary', r.data.items.length >= 47 && r.data.summary.low_stock >= 9, r.data.summary);
  check('low stock listed first', r.data.items[0].stock_status !== 'OK');
  r = await call('GET', '/api/inventory?low_stock=1');
  check('inventory low-stock filter', r.data.items.every(i => i.stock_status !== 'OK'));

  section('Reports');
  r = await call('GET', '/api/reports');
  check('5 reports returned', r.data.length === 5, r.data.length);
  for (const rep of r.data) check(`report ${rep.id} "${rep.title}" has rows + explanation`, rep.rows.length > 0 && rep.question && rep.explanation, rep.id);
  r = await call('GET', '/api/reports/4');
  check('low-stock report rows are all below reorder', r.data.rows.every(x => x.stock_qty < x.reorder_level));
  r = await call('GET', '/api/reports/9');
  check('unknown report -> 404', r.status === 404);

  section('Misc');
  r = await call('GET', '/api/nope');
  check('unknown endpoint -> 404 JSON', r.status === 404 && r.data.error);
  r = await call('GET', '/api/products/abc');
  check('bad id -> 400', r.status === 400);
  r = await call('GET', '/');
  check('client index served', r.status === 200 || r.status === undefined);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
