const express = require("express");
const router = express.Router();
const daraja = require("../lib/daraja");
const paymentStore = require("../lib/paymentStore");
const ordersStore = require("../lib/ordersStore");

/**
 * POST /api/mpesa/stkpush
 * body: { phone, amount, accountReference, description }
 * Initiates an STK push and returns { checkoutRequestId } for polling.
 */
router.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount, accountReference, description } = req.body || {};

    if (!phone || !/^254\d{9}$/.test(String(phone))) {
      return res.status(400).json({ error: "Provide a valid phone number in 2547XXXXXXXX format." });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Amount must be greater than zero." });
    }

    const result = await daraja.stkPush({ phone, amount, accountReference, description });

    if (String(result.ResponseCode) !== "0") {
      return res.status(502).json({ error: result.ResponseDescription || "M-Pesa rejected the request." });
    }

    paymentStore.savePending(result.CheckoutRequestID, {
      merchantRequestId: result.MerchantRequestID,
      phone,
      amount,
      accountReference
    });

    res.json({ checkoutRequestId: result.CheckoutRequestID, merchantRequestId: result.MerchantRequestID });
  } catch (err) {
    console.error("STK push error:", err.response ? err.response.data : err.message);
    res.status(500).json({ error: "Could not start the M-Pesa push. Check server logs / credentials." });
  }
});

/**
 * POST /api/mpesa/callback
 * Safaricom calls this URL with the result of the STK push.
 * Must be a public HTTPS URL set as MPESA_CALLBACK_URL and registered with Safaricom.
 */
router.post("/callback", (req, res) => {
  try {
    const body = req.body || {};
    const stkCallback = body.Body && body.Body.stkCallback;
    if (!stkCallback) {
      console.warn("Unexpected callback payload:", JSON.stringify(body));
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;

    if (resultCode === 0) {
      const items = (stkCallback.CallbackMetadata && stkCallback.CallbackMetadata.Item) || [];
      const get = (name) => {
        const item = items.find((i) => i.Name === name);
        return item ? item.Value : undefined;
      };
      const receipt = get("MpesaReceiptNumber");

      paymentStore.updateStatus(checkoutRequestId, {
        status: "success",
        receipt: receipt,
        amount: get("Amount"),
        phone: get("PhoneNumber"),
        transactionDate: get("TransactionDate")
      });

      // The AccountReference we sent at STK push time is the order id.
      const pending = paymentStore.get(checkoutRequestId);
      if (pending && pending.accountReference && ordersStore.isEnabled()) {
        ordersStore.markPaidByOrderId(pending.accountReference, receipt).catch((err) => {
          console.error("Could not mark order paid in DB:", err.message);
        });
      }
    } else {
      paymentStore.updateStatus(checkoutRequestId, {
        status: "failed",
        resultDesc: stkCallback.ResultDesc
      });
    }

    // Safaricom just needs a 200 with this shape to stop retrying.
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("Callback handling error:", err.message);
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

/**
 * GET /api/mpesa/status/:checkoutRequestId
 * The frontend polls this while waiting for the callback to land.
 */
router.get("/status/:checkoutRequestId", (req, res) => {
  const record = paymentStore.get(req.params.checkoutRequestId);
  if (!record) {
    return res.status(404).json({ status: "unknown" });
  }
  res.json({
    status: record.status,
    receipt: record.receipt,
    resultDesc: record.resultDesc,
    amount: record.amount,
    phone: record.phone
  });
});

module.exports = router;
