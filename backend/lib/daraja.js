const axios = require("axios");

const ENV = (process.env.MPESA_ENV || "sandbox").toLowerCase();
const BASE_URL = ENV === "production"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

let cachedToken = null;
let cachedTokenExpiry = 0;

/**
 * Fetches (and caches) an OAuth access token from Safaricom.
 * Tokens are valid for 1 hour; we refresh a little early to be safe.
 */
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) {
    return cachedToken;
  }

  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    throw new Error("MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET are not set");
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const res = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });

  cachedToken = res.data.access_token;
  // expires_in is in seconds; refresh 60s before actual expiry
  cachedTokenExpiry = now + (Number(res.data.expires_in || 3599) - 60) * 1000;
  return cachedToken;
}

function timestampNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function buildPassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

/**
 * Initiates an STK Push (Lipa Na M-Pesa Online) request.
 * transactionType: "CustomerPayBillOnline" or "CustomerBuyGoodsOnline"
 */
async function stkPush({ phone, amount, accountReference, description }) {
  const token = await getAccessToken();
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const partyB = process.env.MPESA_TILL_NUMBER || shortcode;
  const transactionType = process.env.MPESA_TRANSACTION_TYPE || "CustomerBuyGoodsOnline";
  const callbackUrl = process.env.MPESA_CALLBACK_URL;

  if (!shortcode || !passkey || !callbackUrl) {
    throw new Error("MPESA_SHORTCODE / MPESA_PASSKEY / MPESA_CALLBACK_URL are not set");
  }

  const timestamp = timestampNow();
  const password = buildPassword(shortcode, passkey, timestamp);

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: transactionType,
    Amount: Math.max(1, Math.round(Number(amount) || 0)),
    PartyA: phone,
    PartyB: partyB,
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: String(accountReference || "BooksPODKE").slice(0, 12),
    TransactionDesc: String(description || "Book print order").slice(0, 13)
  };

  const res = await axios.post(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
    headers: { Authorization: `Bearer ${token}` }
  });

  return res.data; // includes MerchantRequestID, CheckoutRequestID, ResponseCode, etc.
}

module.exports = { getAccessToken, stkPush, BASE_URL, ENV };
