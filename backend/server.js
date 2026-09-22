require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mpesaRoutes = require("./routes/mpesa");
const ordersRoutes = require("./routes/orders");
const { initSchema } = require("./lib/db");

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";

app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ ok: true, service: "Books Print on Demand KE — API" });
});

app.use("/api/mpesa", mpesaRoutes);
app.use("/api/orders", ordersRoutes);

initSchema()
  .catch((err) => console.error("Schema init failed:", err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`API listening on port ${PORT} (env: ${process.env.MPESA_ENV || "sandbox"})`);
    });
  });
