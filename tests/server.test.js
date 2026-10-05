// Server setup problems, translation, escalation and push key. No network or keys needed.
import { test } from "node:test";
import assert from "node:assert/strict";

// Values pasted into Vercel with a trailing slash or newline must still work.
process.env.VITE_SUPABASE_URL = "https://proj.supabase.co/\n";
process.env.VITE_SUPABASE_ANON_KEY = " anon\n";
process.env.GEMINI_API_KEY = "g";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.CRON_SECRET;
delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;

const { authUser, configStatus } = await import("../api/_lib/server.js");
const { default: translate } = await import("../api/translate.js");
const { default: escalate } = await import("../api/escalate.js");
const { default: health } = await import("../api/health.js");
const { default: pushKey } = await import("../api/push-key.js");
const { toE164 } = await import("../api/_lib/channels.js");

let seen = [];
function fake({ auth = 200, gemini = { texts: ["Hola"] } } = {}) {
  seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    seen.push({ url: String(url), headers: opts.headers || {} });
    if (String(url).includes("/auth/v1/user")) return { ok: auth === 200, status: auth, json: async () => ({ id: "u1" }), text: async () => "bad jwt" };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(gemini) }] } }] }), text: async () => "" };
  };
}
const run = (fn, req) => new Promise((resolve) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); resolve(this); } };
  fn({ headers: {}, ...req }, res);
});

test("trailing slash and newline in env values are cleaned", async () => {
  fake();
  const a = await authUser({ headers: { authorization: "Bearer tok" } });
  assert.equal(a.user.id, "u1");
  assert.equal(seen[0].url, "https://proj.supabase.co/auth/v1/user");
  assert.equal(seen[0].headers.apikey, "anon");
});
test("expired session is 401 auth; Supabase down is 502 upstream", async () => {
  fake({ auth: 401 }); assert.deepEqual(await authUser({ headers: { authorization: "Bearer x" } }), { error: "auth", status: 401 });
  fake({ auth: 500 }); assert.deepEqual(await authUser({ headers: { authorization: "Bearer x" } }), { error: "upstream", status: 502 });
  assert.equal((await authUser({ headers: {} })).status, 401);
});
test("translate returns texts in order and checks the count", async () => {
  fake({ gemini: { texts: ["Hola", "Gracias"] } });
  let r = await run(translate, { method: "POST", headers: { authorization: "Bearer t" }, body: { texts: ["Hi", "Thanks"], target: "es" } });
  assert.equal(r.statusCode, 200); assert.deepEqual(r.body.texts, ["Hola", "Gracias"]);
  fake({ gemini: { texts: ["Hola"] } });
  r = await run(translate, { method: "POST", headers: { authorization: "Bearer t" }, body: { texts: ["Hi", "Thanks"], target: "es" } });
  assert.equal(r.statusCode, 502);
  r = await run(translate, { method: "POST", headers: { authorization: "Bearer t" }, body: { texts: ["Hi"], target: "fr" } });
  assert.equal(r.statusCode, 400);
  r = await run(translate, { method: "POST", headers: {}, body: { texts: ["Hi"], target: "es" } });
  assert.equal(r.statusCode, 401);
});
test("escalation endpoint needs the cron secret", async () => {
  let r = await run(escalate, { method: "POST", headers: { authorization: "Bearer anything" } });
  assert.equal(r.statusCode, 401);
  process.env.CRON_SECRET = "s3cret";
  r = await run(escalate, { method: "POST", headers: { authorization: "Bearer wrong" } });
  assert.equal(r.statusCode, 401);
  r = await run(escalate, { method: "POST", headers: { authorization: "Bearer s3cret" } });
  assert.equal(r.statusCode, 503); // no service-role key in tests
});
test("health shows what's configured, never values", async () => {
  const r = await run(health, { method: "GET" });
  assert.equal(r.body.configured.supabase, true); assert.equal(r.body.configured.push, false);
  assert.ok(!JSON.stringify(r.body).includes("anon"));
  assert.equal(configStatus().ai, true);
});
test("push key is empty until push is set up", async () => {
  assert.equal((await run(pushKey, { method: "GET" })).body.key, "");
});
test("US phone numbers become E.164 for texts", () => {
  assert.equal(toE164("(404) 555-0100"), "+14045550100");
  assert.equal(toE164("1-404-555-0100"), "+14045550100");
  assert.equal(toE164("+44 20 7946 0958"), "+442079460958");
  assert.equal(toE164("555-0100"), null);
});
