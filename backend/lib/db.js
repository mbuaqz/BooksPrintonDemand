const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Most managed Postgres hosts (Render, Railway, etc.) require SSL,
      // and use certs that aren't in Node's default trust store.
      ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

async function initSchema() {
  const p = getPool();
  if (!p) {
    console.warn("DATABASE_URL not set — orders will not be persisted server-side.");
    return;
  }
  await p.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      notes TEXT,
      items JSONB NOT NULL,
      total NUMERIC NOT NULL,
      status TEXT NOT NULL DEFAULT 'New',
      payment_status TEXT NOT NULL DEFAULT 'Unpaid',
      mpesa_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log("Database schema ready.");
}

module.exports = { getPool, initSchema };
