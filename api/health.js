// GET /api/health — shows which server settings are present (true/false only, never the values).
// Open https://YOUR-APP/api/health after changing Vercel environment variables to check them.
import { send, configStatus } from "./_lib/server.js";

export default function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET" });
  return send(res, 200, { ok: true, configured: configStatus() });
}
