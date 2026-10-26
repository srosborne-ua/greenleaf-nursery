// Category, supplier, customer and employee routers (plain CRUD + search).
const { crudRouter } = require('../lib/crud');
const { validator } = require('../lib/validate');

const category = crudRouter({
  table: 'category', pk: 'category_id', name: 'Category', alias: 'c',
  select: `SELECT c.*, (SELECT COUNT(*) FROM product p WHERE p.category_id = c.category_id) AS product_count
           FROM category c`,
  search: ['c.name', 'c.description'],
  orderBy: 'c.name',
  inUse: 'This category still has products. Move or delete those products first, then delete the category.',
  validate: b => validator(b)
    .str('name', { required: true, max: 60 })
    .str('description', { max: 255 })
    .done(),
});

const supplier = crudRouter({
  table: 'supplier', pk: 'supplier_id', name: 'Supplier', alias: 's',
  select: `SELECT s.*, (SELECT COUNT(*) FROM purchase pu WHERE pu.supplier_id = s.supplier_id) AS purchase_count,
                  (SELECT COUNT(*) FROM product_supplier ps WHERE ps.supplier_id = s.supplier_id) AS product_count
           FROM supplier s`,
  search: ['s.name', 's.contact_name', 's.email'],
  orderBy: 's.name',
  inUse: 'This supplier has purchase history and cannot be deleted. (Purchases are financial records.)',
  validate: b => validator(b)
    .str('name', { required: true, max: 100 })
    .str('contact_name', { max: 100 })
    .email('email', { max: 120 })
    .str('phone', { max: 25 })
    .str('address', { max: 200 })
    .done(),
});

const customer = crudRouter({
  table: 'customer', pk: 'customer_id', name: 'Customer', alias: 'c',
  select: `SELECT c.*, (SELECT COUNT(*) FROM customer_order o WHERE o.customer_id = c.customer_id) AS order_count
           FROM customer c`,
  search: ['c.first_name', 'c.last_name', 'c.email', "CONCAT(c.first_name, ' ', c.last_name)"],
  orderBy: 'c.last_name, c.first_name',
  inUse: 'This customer has orders and cannot be deleted. (Orders are sales records.)',
  validate: b => validator(b)
    .str('first_name', { required: true, max: 50 })
    .str('last_name', { required: true, max: 50 })
    .email('email', { required: true, max: 120 })
    .str('phone', { max: 25 })
    .str('address', { max: 200 })
    .done(),
});

const employee = crudRouter({
  table: 'employee', pk: 'employee_id', name: 'Employee', alias: 'e',
  select: `SELECT e.*, (SELECT COUNT(*) FROM customer_order o WHERE o.employee_id = e.employee_id) AS orders_processed
           FROM employee e`,
  search: ['e.first_name', 'e.last_name', 'e.email'],
  orderBy: 'e.last_name, e.first_name',
  inUse: 'This employee processed orders or purchases and cannot be deleted.',
  validate: b => validator(b)
    .str('first_name', { required: true, max: 50 })
    .str('last_name', { required: true, max: 50 })
    .email('email', { required: true, max: 120 })
    .oneOf('role', ['Employee', 'Manager'], { default: 'Employee' })
    .date('hire_date', { required: true })
    .done(),
});

module.exports = { category, supplier, customer, employee };
