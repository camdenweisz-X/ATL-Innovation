// Admin dashboard: only confirmed admin emails get data, and the report carries metadata, never content.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdminReport, isAdmin, maskEmail, parseAdminEmails } from "../shared/admin.js";

process.env.VITE_SUPABASE_URL = "https://proj.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "anon";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const { default: admin } = await import("../api/admin.js");

function call({ user, url = "/api/admin", method = "GET", auth = "Bearer tok" } = {}) {
  globalThis.fetch = async (u) => {
    if (String(u).includes("/auth/v1/user")) return user ? { ok: true, status: 200, json: async () => user } : { ok: false, status: 403, text: async () => "session_not_found" };
    throw new Error("unexpected fetch " + u);
  };
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); resolve(this); } };
    admin({ method, url, headers: auth ? { authorization: auth } : {} }, res);
  });
}
const owner = { id: "u1", email: "Owner@Example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };

test("signed-out callers get 401", async () => { const r = await call({ auth: "" }); assert.equal(r.statusCode, 401); });
test("non-admins get 404", async () => {
  process.env.ADMIN_EMAILS = "owner@example.com";
  const r = await call({ user: { id: "u2", email: "someone@x.com", email_confirmed_at: "2026-10-01T00:00:00Z" } });
  assert.equal(r.statusCode, 404);
});
test("unconfirmed admin email gets 404", async () => {
  process.env.ADMIN_EMAILS = "owner@example.com";
  const r = await call({ user: { ...owner, email_confirmed_at: null } });
  assert.equal(r.statusCode, 404);
});
test("no ADMIN_EMAILS means nobody is admin", async () => { delete process.env.ADMIN_EMAILS; const r = await call({ user: owner }); assert.equal(r.statusCode, 404); });
test("admin probe works without the service key", async () => {
  process.env.ADMIN_EMAILS = " owner@example.com , other@x.com";
  const r = await call({ user: owner, url: "/api/admin?probe=1" });
  assert.equal(r.statusCode, 200); assert.equal(r.body.admin, true);
});
test("admin without the service key gets 503", async () => { process.env.ADMIN_EMAILS = "owner@example.com"; const r = await call({ user: owner }); assert.equal(r.statusCode, 503); });

test("helpers", () => {
  assert.equal(maskEmail("camden@gmail.com"), "ca••••@gmail.com");
  assert.equal(maskEmail("a@b.co"), "a••••@b.co");
  assert.deepEqual(parseAdminEmails(" A@x.com,,b@y.com "), ["a@x.com", "b@y.com"]);
  assert.equal(isAdmin(owner, ["owner@example.com"]), true);
  assert.equal(isAdmin({ email: "owner@example.com" }, ["owner@example.com"]), false);
});

test("report: summary, feed order and no content", () => {
  const now = Date.parse("2026-10-05T08:00:00Z");
  const r = buildAdminReport({
    users: [
      { id: "a", email: "alice@gmail.com", created_at: "2026-10-04T10:00:00Z", last_sign_in_at: "2026-10-05T07:00:00Z", app_metadata: { providers: ["google"] } },
      { id: "b", email: "bob@x.com", created_at: "2026-09-01T10:00:00Z", app_metadata: { provider: "email" } },
    ],
    profiles: [{ id: "a", onboarded: true, lang: "es" }],
    properties: [{ id: "p", created_by: "b", created_at: "2026-09-02T00:00:00Z" }],
    memberships: [{ user_id: "b", property_id: "p", role: "manager", created_at: "2026-09-02T00:00:00Z" }, { user_id: "a", property_id: "p", role: "resident", created_at: "2026-10-04T11:00:00Z" }],
    requests: [
      { id: "r1", resident_id: "a", created_at: "2026-10-04T12:00:00Z", urgency: "Urgent", ai_urgency: "Urgent", category: "Plumbing / Water", has_photo: true, after_hours: true, description: "SECRET", body: "SECRET" },
      { id: "r2", resident_id: "a", created_at: "2026-10-04T13:00:00Z", urgency: "Routine", ai_urgency: "Urgent", category: "Other", has_photo: false },
    ],
    events: [{ request_id: "r1", actor_id: "b", kind: "message", body: "SECRET", created_at: "2026-10-04T14:00:00Z" }, { request_id: "r1", actor_id: "a", kind: "created", created_at: "2026-10-04T12:00:00Z" }],
    usage: [{ user_id: "a", kind: "triage", created_at: "2026-10-05T06:00:00Z" }],
  }, now);
  assert.equal(r.summary.accounts, 2); assert.equal(r.summary.new_7d, 1); assert.equal(r.summary.active_7d, 2); // bob sent a message this week
  assert.equal(r.summary.requests, 2); assert.equal(r.summary.ai_kept_rate, 50); assert.equal(r.summary.checks_24h, 1);
  assert.equal(r.feed[0].text, "Signed in");
  assert.ok(r.feed.some((e) => e.text.includes("changed the AI's Urgent to Routine")));
  assert.ok(!r.feed.some((e) => e.text === "Joined a property as a manager"), "creator's own manager membership isn't repeated");
  const json = JSON.stringify(r);
  assert.ok(!json.includes("SECRET")); assert.ok(!json.includes("alice@gmail.com")); assert.ok(json.includes("al••••@gmail.com"));
  assert.deepEqual(r.accounts.find((a) => a.id === "a").roles, ["resident"]);
});
