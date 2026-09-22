/**
 * Protects admin-only endpoints with a shared secret key.
 * The studio owner enters this same key once into Studio settings in the
 * browser; it's sent as the 'x-admin-key' header on every admin request.
 */
function requireAdmin(req, res, next) {
  const configuredKey = process.env.ADMIN_API_KEY;
  if (!configuredKey) {
    return res.status(500).json({ error: "ADMIN_API_KEY is not set on the server." });
  }
  const providedKey = req.header("x-admin-key");
  if (!providedKey || providedKey !== configuredKey) {
    return res.status(401).json({ error: "Invalid or missing admin key." });
  }
  next();
}

module.exports = requireAdmin;
