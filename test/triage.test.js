// Offline tests: no API key or network needed. Run: node test/triage.test.js
"use strict";
const assert = require("assert");
const { normalizeAI, buildPrompt } = require("../lib/shared.js");
process.env.GEMINI_API_KEY = "test-key";
const triage = require("../api/triage.js");

function fakeRes() { const r = { headers:{}, setHeader(k,v){this.headers[k]=v;}, end(b){ this.body = JSON.parse(b); this.done(); } }; r.p = new Promise(ok => r.done = ok); return r; }
let calls = [];
async function call(body, modelText, status = 200) {
  calls = [];
  const statuses = Array.isArray(status) ? status.slice() : [status];
  global.fetch = async (url, opts) => { calls.push({ url, headers: opts.headers }); const st = statuses.length > 1 ? statuses.shift() : statuses[0];
    return { ok: st === 200, status: st, json: async () => ({ candidates: [{ content: { parts: [{ text: modelText }] } }] }), text: async () => "err" }; };
  const res = fakeRes(); await triage({ method: "POST", body }, res); await res.p; return res;
}
const good = JSON.stringify({ urgency:"urgent", reason:"Slow leak can be contained.", safety_message:"", until_fixed:["Put a bucket under it"], category:"plumbing / water", title:"Ceiling drip over sink", request:"Water drips from the ceiling. It started [date].", questions:["Is it getting worse?"], photo_notes:"Water stain" });

(async () => {
  // 1. normal reply, lowercase fields get normalized
  let r = await call({ description: "drip from ceiling", checklist: {} }, good);
  assert.equal(r.statusCode, 200); assert.equal(r.body.urgency, "Urgent"); assert.equal(r.body.category, "Plumbing / Water");
  // 2. checklist yes forces Emergency even if the model says Urgent
  r = await call({ description: "drip", checklist: { gas: "yes" } }, good);
  assert.equal(r.body.urgency, "Emergency");
  // 3. JSON wrapped in prose / code fence still parses
  r = await call({ description: "drip" }, "Here you go:\n```json\n" + good + "\n```");
  assert.equal(r.statusCode, 200);
  // 4. malformed reply -> 502 so the app falls back to the basic form
  r = await call({ description: "drip" }, "I think it's fine");
  assert.equal(r.statusCode, 502);
  r = await call({ description: "drip" }, JSON.stringify({ urgency: "Kinda bad", request: "x" }));
  assert.equal(r.statusCode, 502);
  // 5. empty input rejected, upstream failure -> 502, rate limit -> 429
  r = await call({ description: "" }, good); assert.equal(r.statusCode, 400);
  r = await call({ description: "x" }, good, 500); assert.equal(r.statusCode, 502);
  r = await call({ description: "x" }, good, 429); assert.equal(r.statusCode, 429);
  // 5b. first model busy -> falls back to the second model and succeeds
  r = await call({ description: "x" }, good, [429, 200]);
  assert.equal(r.statusCode, 200); assert.equal(calls.length, 2); assert.ok(calls[1].url.includes("flash-lite"));
  // 5c. bad key (403) does not retry; key goes in a header, never the URL
  r = await call({ description: "x" }, good, 403);
  assert.equal(r.statusCode, 502); assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes("test-key")); assert.equal(calls[0].headers["x-goog-api-key"], "test-key");
  // 5d. photo is sent as inline image data
  r = await call({ description: "x", image: { mediaType: "image/jpeg", data: "AAAA" } }, good);
  assert.equal(r.statusCode, 200);
  // 6. prompt carries the rules and the checklist
  const p = buildPrompt({ description: "smell gas", checklist: { gas: "yes", co: "no" }, localTime: "Sun 10:40 PM", afterHours: true, hasPhoto: true });
  assert.ok(p.includes("choose the MORE urgent")); assert.ok(p.includes("answered YES: Do you smell gas")); assert.ok(p.includes("photo of the problem"));
  // 7. too many questions trimmed to 4
  assert.equal(normalizeAI({ urgency:"Routine", request:"x", questions:[1,2,3,4,5,6] }).questions.length, 4);
  console.log("All triage tests passed");
})().catch(e => { console.error(e); process.exit(1); });
