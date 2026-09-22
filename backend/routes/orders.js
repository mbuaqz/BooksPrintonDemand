const express = require("express");
const router = express.Router();
const ordersStore = require("../lib/ordersStore");
const requireAdmin = require("../lib/requireAdmin");

/**
 * POST /api/orders
 * Public — a client submits their quote request. No login needed, same as
 * walking up to the counter with a printed quote.
 */
router.post("/", async (req, res) => {
  try {
    const { id, name, contact, notes, items, total } = req.body || {};
    if (!id || !name || !contact || !Array.isArray(items) || !total) {
      return res.status(400).json({ error: "Missing required order fields." });
    }
    const saved = await ordersStore.createOrder({ id, name, contact, notes, items, total });
    res.status(201).json(saved);
  } catch (err) {
    console.error("Create order error:", err.message);
    res.status(500).json({ error: "Could not save the order. Is DATABASE_URL configured?" });
  }
});

/**
 * POST /api/orders/:id/mpesa-code
 * Public — a customer reporting the M-Pesa code for their OWN order after
 * paying manually via Till. Low-risk by design: it only ever attaches a
 * code to an order, it can't reveal other customers' data, and staff still
 * verify the code against Safaricom before fulfilling.
 */
router.post("/:id/mpesa-code", async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "Missing M-Pesa code." });
    const updated = await ordersStore.updateOrder(req.params.id, { mpesaCode: code });
    if (!updated) return res.status(404).json({ error: "Order not found." });
    res.json(updated);
  } catch (err) {
    console.error("Save mpesa code error:", err.message);
    res.status(500).json({ error: "Could not save the code." });
  }
});

/**
 * GET /api/orders
 * Admin-only — the Studio mode order queue.
 */
router.get("/", requireAdmin, async (req, res) => {
  try {
    const orders = await ordersStore.listOrders();
    res.json(orders);
  } catch (err) {
    console.error("List orders error:", err.message);
    res.status(500).json({ error: "Could not load orders." });
  }
});

/**
 * PATCH /api/orders/:id
 * Admin-only — update status, payment status, or M-Pesa code from Studio mode.
 */
router.patch("/:id", requireAdmin, async (req, res) => {
  try {
    const updated = await ordersStore.updateOrder(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Order not found or nothing to update." });
    res.json(updated);
  } catch (err) {
    console.error("Update order error:", err.message);
    res.status(500).json({ error: "Could not update the order." });
  }
});

/**
 * DELETE /api/orders/:id
 * Admin-only.
 */
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const deleted = await ordersStore.deleteOrder(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Order not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete order error:", err.message);
    res.status(500).json({ error: "Could not delete the order." });
  }
});

module.exports = router;
