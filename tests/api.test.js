// Server function tests. No network or keys needed: fetch is replaced with fakes.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.GEMINI_API_KEY = "test-gemini";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.VITE_SUPABASE_URL = "https://proj.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "anon";
const { default: triage } = await import("../api/triage.js");
const { normalizeAI, buildPrompt } = await import("../shared/triage.js");

const good = { urgency: "urgent", reason: "Slow leak.", safety_message: "", until_fixed: ["Bucket"], category: "plumbing / water", title: "Ceiling drip", request: "Water drips [date].", questions: ["Worse?"], photo_notes: "" };
let calls = [];
function fakeFetch({ authOk = true, gemini = [200], text = JSON.stringify(good) } = {}) {
  const statuses = gemini.slice();
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), headers: opts.headers || {} });
    if (String(url).includes("/auth/v1/user")) return { ok: authOk, status: authOk ? 200 : 401, json: async () => ({ id: "user-" + Math.random() }) };
    const st = statuses.length > 1 ? statuses.shift() : statuses[0];
    return { ok: st === 200, status: st, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }), text: async () => "err" };
  };
}
function call(body, { auth = "Bearer tok" } = {}) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); resolve(this); } };
    triage({ method: "POST", headers: auth ? { authorization: auth } : {}, body }, res);
  });
}

test("rejects anonymous callers", async () => { fakeFetch(); const r = await call({ description: "x" }, { auth: "" }); assert.equal(r.statusCode, 401); });
test("rejects invalid sessions", async () => { fakeFetch({ authOk: false }); const r = await call({ description: "x" }); assert.equal(r.statusCode, 401); });
test("normal reply is cleaned up", async () => {
  fakeFetch(); const r = await call({ description: "drip" });
  assert.equal(r.statusCode, 200); assert.equal(r.body.urgency, "Urgent"); assert.equal(r.body.category, "Plumbing / Water");
});
test("safety Yes forces Emergency", async () => { fakeFetch(); const r = await call({ description: "drip", checklist: { gas: "yes" } }); assert.equal(r.body.urgency, "Emergency"); });
test("busy model falls back to the next", async () => {
  calls = []; fakeFetch({ gemini: [429, 200] }); const r = await call({ description: "x" });
  assert.equal(r.statusCode, 200); assert.ok(calls.filter((c) => c.url.includes("generativelanguage")).at(-1).url.includes("flash-lite"));
});
test("bad key is not retried and key stays out of URLs", async () => {
  calls = []; fakeFetch({ gemini: [403] }); const r = await call({ description: "x" });
  assert.equal(r.statusCode, 502);
  const g = calls.filter((c) => c.url.includes("generativelanguage"));
  assert.equal(g.length, 1); assert.ok(!g[0].url.includes("test-gemini")); assert.equal(g[0].headers["x-goog-api-key"], "test-gemini");
});
test("malformed AI reply -> 502", async () => { fakeFetch({ text: "not json" }); const r = await call({ description: "x" }); assert.equal(r.statusCode, 502); });
test("empty report -> 400", async () => { fakeFetch(); const r = await call({ description: "" }); assert.equal(r.statusCode, 400); });
test("oversized image -> 413", async () => { fakeFetch(); const r = await call({ description: "x", image: { mediaType: "image/jpeg", data: "A".repeat(4 * 1024 * 1024 + 1) } }); assert.equal(r.statusCode, 413); });
test("normalizeAI trims lists and rejects bad urgency", () => {
  assert.equal(normalizeAI({ urgency: "Routine", request: "x", questions: [1, 2, 3, 4, 5] }).questions.length, 3);
  assert.throws(() => normalizeAI({ urgency: "Kinda bad", request: "x" }));
});
test("prompt includes rules and checklist", () => {
  const p = buildPrompt({ description: "gas", checklist: { gas: "yes" }, localTime: "Sun 10pm", afterHours: true, hasPhoto: true });
  assert.ok(p.includes("choose the MORE urgent")); assert.ok(p.includes("answered YES: Do you smell gas"));
});

// 2.2
const { safetyHints } = await import("../shared/triage.js");
test("prompt asks for Spanish when the resident uses Spanish", () => {
  const es = buildPrompt({ description: "fuga", checklist: {}, localTime: "x", afterHours: false, hasPhoto: false, lang: "es" });
  assert.ok(es.includes("Spanish")); assert.ok(es.includes("Keep \"urgency\" and \"category\" exactly"));
  assert.ok(buildPrompt({ description: "leak", checklist: {}, localTime: "x", afterHours: false, hasPhoto: false }).includes("in English"));
});
test("lang is passed through to the AI", async () => {
  calls = []; let sent = "";
  fakeFetch();
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { if (String(url).includes("generativelanguage")) sent = opts.body; return orig(url, opts); };
  await call({ description: "hay una fuga", lang: "es" });
  assert.ok(sent.includes("Spanish"));
});
test("danger words are caught in English and Spanish", () => {
  assert.deepEqual(safetyHints("I smell gas near the stove"), ["gas"]);
  assert.deepEqual(safetyHints("huele a gas en la cocina"), ["gas"]);
  assert.deepEqual(safetyHints("sale humo del enchufe y hay chispas"), ["fire"]);
  assert.deepEqual(safetyHints("Toilet overflowing, sewage on the floor"), ["water"]);
  assert.deepEqual(safetyHints("la alarma de monóxido está sonando"), ["co"]);
  assert.deepEqual(safetyHints("Front door won't lock"), ["lock"]);
  assert.deepEqual(safetyHints("La puerta no cierra"), ["lock"]);
  assert.deepEqual(safetyHints("Light bulb is out in the hallway"), []);
});
test("auth failures are reported as auth, not as a server error", async () => {
  fakeFetch({ authOk: false }); const r = await call({ description: "x" });
  assert.equal(r.statusCode, 401); assert.equal(r.body.code, "auth");
});
