const { getPool } = require("./db");

function isEnabled() {
  return !!getPool();
}

async function createOrder(order) {
  const p = getPool();
  if (!p) throw new Error("Database not configured (DATABASE_URL missing)");
  const { rows } = await p.query(
    `INSERT INTO orders (id, name, contact, notes, items, total, status, payment_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      order.id,
      order.name,
      order.contact,
      order.notes || null,
      JSON.stringify(order.items || []),
      order.total,
      order.status || "New",
      order.paymentStatus || "Unpaid"
    ]
  );
  return rows[0];
}

async function listOrders() {
  const p = getPool();
  if (!p) throw new Error("Database not configured (DATABASE_URL missing)");
  const { rows } = await p.query(`SELECT * FROM orders ORDER BY created_at DESC`);
  return rows;
}

async function updateOrder(id, fields) {
  const p = getPool();
  if (!p) throw new Error("Database not configured (DATABASE_URL missing)");

  const sets = [];
  const values = [];
  let i = 1;

  if (fields.status !== undefined) { sets.push(`status = $${i++}`); values.push(fields.status); }
  if (fields.paymentStatus !== undefined) { sets.push(`payment_status = $${i++}`); values.push(fields.paymentStatus); }
  if (fields.mpesaCode !== undefined) { sets.push(`mpesa_code = $${i++}`); values.push(fields.mpesaCode); }
  sets.push(`updated_at = now()`);

  if (sets.length === 1) return null; // nothing to update besides timestamp

  values.push(id);
  const { rows } = await p.query(
    `UPDATE orders SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] || null;
}

/**
 * Called from the M-Pesa callback handler once a payment resolves, matched
 * by the AccountReference we sent as the order id in the STK push.
 */
async function markPaidByOrderId(orderId, mpesaCode) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query(
    `UPDATE orders SET payment_status = 'Paid', mpesa_code = $1, updated_at = now()
     WHERE id = $2 RETURNING *`,
    [mpesaCode, orderId]
  );
  return rows[0] || null;
}

async function deleteOrder(id) {
  const p = getPool();
  if (!p) throw new Error("Database not configured (DATABASE_URL missing)");
  const { rowCount } = await p.query(`DELETE FROM orders WHERE id = $1`, [id]);
  return rowCount > 0;
}

module.exports = { isEnabled, createOrder, listOrders, updateOrder, deleteOrder, markPaidByOrderId };
