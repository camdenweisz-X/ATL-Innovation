// GET /api/push-key — the public key browsers need to subscribe to phone notifications.
// Empty when push isn't set up (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY), and the app hides the option.
import { send } from "./_lib/server.js";

export default function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET" });
  const key = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  return send(res, 200, { key: process.env.VAPID_PRIVATE_KEY ? key : "" });
}
