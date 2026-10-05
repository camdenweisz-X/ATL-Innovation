// Repeat alerts and Insights numbers (ported from the v1.5 tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { finalUrgency, findRepeats, computeInsights, seenAt, fixedAt } from "../shared/workorders.js";

const NOW = Date.parse("2026-10-05T12:00:00Z"), H = 36e5, D = 864e5;
const iso = (ms) => new Date(ms).toISOString();
let n = 0;
function req(o) {
  return { id: "R" + (++n), created_at: iso(NOW - (o.daysAgo || 0) * D), property_id: o.prop || "p1", unit: o.unit ?? "Apt 1",
    category: o.category || "Plumbing / Water", urgency: o.urgency || "Urgent", ai_urgency: o.ai ?? o.urgency ?? "Urgent", mgr_urgency: o.mgr || null,
    manual_review: false, after_hours: !!o.afterHours, blanks_left: o.blanks ?? 0, has_photo: o.photo ?? true, status: o.status || "new", first_visit: o.first ?? null };
}
const st = (status, at) => ({ kind: "status", status, created_at: iso(at) });

test("final urgency prefers the manager's change", () => {
  assert.equal(finalUrgency({ urgency: "Urgent", mgr_urgency: "Routine" }), "Routine");
  assert.equal(finalUrgency({ urgency: "Urgent", mgr_urgency: null }), "Urgent");
});
test("seen and fixed times come from status events", () => {
  const ev = [st("acknowledged", NOW + H), st("scheduled", NOW + 2 * H), st("resolved", NOW + 2 * D), { kind: "message", status: null, created_at: iso(NOW) }];
  assert.equal(seenAt(ev), NOW + H); assert.equal(fixedAt(ev), NOW + 2 * D); assert.equal(seenAt([]), null);
});
test("repeat alerts: same unit + category, high at three, old ones ignored", () => {
  n = 0;
  const items = [req({ unit: "Apt 214", daysAgo: 41 }), req({ unit: "apt  214", daysAgo: 19 }), req({ unit: "Apt 214", daysAgo: 2 }),
    req({ unit: "Apt 214", daysAgo: 90 }), req({ unit: "Apt 214", daysAgo: 5, category: "Electrical" }),
    req({ unit: "Apt 9", daysAgo: 10 }), req({ unit: "Apt 9", daysAgo: 3 })];
  const r = findRepeats(items, { now: NOW });
  const a = r.alerts.find((x) => x.unit === "Apt 214");
  assert.equal(a.count, 3); assert.equal(a.level, "high"); assert.equal(a.days, 39);
  assert.equal(r.alerts.find((x) => x.unit === "Apt 9").level, "watch");
  assert.equal(r.byId.R3.nth, 3); assert.equal(r.byId.R4, undefined);
  assert.ok(!r.alerts.some((x) => x.category === "Electrical"));
});
test("same unit number at two properties is not a repeat", () => {
  n = 0;
  const r = findRepeats([req({ unit: "Apt 1", prop: "p1", daysAgo: 3 }), req({ unit: "Apt 1", prop: "p2", daysAgo: 1 })], { now: NOW });
  assert.equal(r.alerts.length, 0);
});
test("building-wide: 3 units, same category, within 7 days", () => {
  n = 0;
  const ac = (c) => req({ category: "Heating / AC", ...c });
  let r = findRepeats([ac({ unit: "Apt 305", daysAgo: 4 }), ac({ unit: "Apt 307", daysAgo: 3 }), ac({ unit: "Apt 112", daysAgo: 1 })], { now: NOW });
  assert.equal(r.alerts[0].kind, "building"); assert.equal(r.alerts[0].units, 3);
  r = findRepeats([ac({ unit: "Apt 305", daysAgo: 4 }), ac({ unit: "Apt 307", daysAgo: 3 })], { now: NOW });
  assert.equal(r.alerts.length, 0);
  r = findRepeats([ac({ unit: "Apt 305", daysAgo: 12 }), ac({ unit: "Apt 307", daysAgo: 7 }), ac({ unit: "Apt 112", daysAgo: 1 })], { now: NOW });
  assert.ok(!r.alerts.some((x) => x.kind === "building"));
});
test("insights numbers", () => {
  n = 0;
  const ev = {};
  const fixedReq = (o, ackH, fixH) => { const x = req({ ...o, status: "resolved" }); const c = Date.parse(x.created_at); ev[x.id] = [st("acknowledged", c + ackH * H), st("resolved", c + fixH * H)]; return x; };
  const items = [
    fixedReq({ urgency: "Emergency", afterHours: true, daysAgo: 3, first: true }, 0.25, 2),
    fixedReq({ urgency: "Urgent", afterHours: true, daysAgo: 5, first: false }, 8, 20),
    fixedReq({ urgency: "Routine", afterHours: false, daysAgo: 6, blanks: 2, first: true }, 3, 50),
    req({ urgency: "Urgent", afterHours: true, daysAgo: 1, photo: false, mgr: "Routine", status: "acknowledged" }),
    req({ urgency: "Routine", afterHours: true, daysAgo: 45 }),
    req({ urgency: "Routine", daysAgo: 2, status: "canceled" }),
  ];
  let k = computeInsights(items, ev, { now: NOW, sinceDays: 30 });
  assert.equal(k.total, 4); assert.equal(k.open, 1);
  assert.equal(k.afterHours, 3); assert.equal(k.couldWait, 2); assert.equal(k.calloutSavings, null);
  assert.equal(k.emergencies, 1); assert.equal(k.emergencyAckMs, 0.25 * H);
  assert.equal(k.fixMs, 20 * H); assert.equal(k.firstVisitRate, 67); assert.equal(k.returnTrips, 1);
  assert.equal(k.completeRate, 50); assert.equal(k.reviewed, 4); assert.equal(k.keptRate, 75);
  k = computeInsights(items, ev, { now: NOW, sinceDays: 0, calloutCost: "250", tripCost: 120 });
  assert.equal(k.total, 5); assert.equal(k.couldWait, 3); assert.equal(k.calloutSavings, 750); assert.equal(k.returnTripCost, 120);
  assert.equal(computeInsights([], {}, { now: NOW }).firstVisitRate, null);
});
