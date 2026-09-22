const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "payments.json");

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}");
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function savePending(checkoutRequestId, meta) {
  const all = readAll();
  all[checkoutRequestId] = Object.assign(
    { status: "pending", createdAt: Date.now() },
    meta
  );
  writeAll(all);
}

function updateStatus(checkoutRequestId, update) {
  const all = readAll();
  all[checkoutRequestId] = Object.assign(
    all[checkoutRequestId] || { createdAt: Date.now() },
    update,
    { updatedAt: Date.now() }
  );
  writeAll(all);
}

function get(checkoutRequestId) {
  const all = readAll();
  return all[checkoutRequestId] || null;
}

module.exports = { savePending, updateStatus, get };
