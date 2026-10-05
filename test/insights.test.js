// Offline tests for work orders, repeat alerts and the Insights numbers. Run: node test/insights.test.js
"use strict";
const assert = require("assert");
const { statusOf, finalUrgency, applyUpdate, findRepeats, computeInsights, seenAt, fixedAt } = require("../lib/shared.js");

const NOW = Date.parse("2026-10-05T12:00:00Z"), H = 36e5, D = 864e5;
const iso = ms => new Date(ms).toISOString();
let n = 0;
function req(o) {
  const created = NOW - (o.daysAgo || 0) * D;
  return { id: "WO-" + (++n), createdAt: iso(created), unit: o.unit || "Apt 1", propCode: "FC-TEST-0000", category: o.category || "Plumbing / Water",
    urgency: o.urgency || "Urgent", suggested: o.suggested || o.urgency || "Urgent", aiUrgency: o.urgency || "Urgent", manualReview: false,
    afterHours: !!o.afterHours, blanksLeft: o.blanksLeft, hasPhoto: o.hasPhoto, status: "new", history: [{ s: "new", at: iso(created) }], ...o.extra };
}

// 1. Status: old "done" items count as fixed; history is logged; reschedule is logged again.
assert.equal(statusOf({ status: "done" }), "fixed");
assert.equal(statusOf({}), "new");
let w = req({});
w = applyUpdate(w, { status: "seen" }, iso(NOW + H));
w = applyUpdate(w, { status: "scheduled", scheduledFor: iso(NOW + D), tech: "Marcus", note: "Keep pets in" }, iso(NOW + 2 * H));
w = applyUpdate(w, { status: "scheduled", scheduledFor: iso(NOW + 2 * D) }, iso(NOW + 3 * H));
w = applyUpdate(w, { status: "fixed", firstVisit: false }, iso(NOW + 2 * D));
assert.deepEqual(w.history.map(h => h.s), ["new", "seen", "scheduled", "scheduled", "fixed"]);
assert.equal(w.note, undefined, "note is only kept in history");
assert.equal(seenAt(w) - Date.parse(w.createdAt), H);
assert.equal(fixedAt(w) - Date.parse(w.createdAt), 2 * D);
// marking seen twice does not add a second entry
assert.equal(applyUpdate(applyUpdate(req({}), { status: "seen" }, iso(NOW)), { status: "seen" }, iso(NOW)).history.length, 2);

// 2. Manager urgency override wins and is logged; reverting clears it.
let u = applyUpdate(req({ urgency: "Urgent" }), { mgrUrgency: "Routine" }, iso(NOW));
assert.equal(finalUrgency(u), "Routine");
assert.equal(u.history.at(-1).note, "Urgency changed to Routine");
assert.equal(finalUrgency(applyUpdate(u, { mgrUrgency: "" }, iso(NOW))), "Urgent");

// 3. Repeat alerts: same unit + category twice in 60 days, "high" at three; old reports don't count.
n = 0;
const repeat = [
  req({ unit: "Apt 214", daysAgo: 41 }), req({ unit: "apt  214", daysAgo: 19 }), req({ unit: "Apt 214", daysAgo: 2 }),
  req({ unit: "Apt 214", daysAgo: 90 }),                             // too old
  req({ unit: "Apt 214", daysAgo: 5, category: "Electrical" }),      // different category
  req({ unit: "Apt 9", daysAgo: 10 }), req({ unit: "Apt 9", daysAgo: 3 }),
];
let r = findRepeats(repeat, { now: NOW });
const a214 = r.alerts.find(a => a.unit === "Apt 214");
assert.equal(a214.count, 3); assert.equal(a214.level, "high"); assert.equal(a214.days, 39);
assert.equal(r.alerts.find(a => a.unit === "Apt 9").level, "watch");
assert.equal(r.byId["WO-3"].nth, 3); assert.equal(r.byId["WO-4"], undefined);
assert.ok(!r.alerts.some(a => a.category === "Electrical"));

// 4. Building-wide: 3 different units, same category, within 7 days. 2 units, or spread over 10 days, is not.
n = 0;
const ac = c => req({ category: "Heating / AC", ...c });
r = findRepeats([ac({ unit: "Apt 305", daysAgo: 4 }), ac({ unit: "Apt 307", daysAgo: 3 }), ac({ unit: "Apt 112", daysAgo: 1 })], { now: NOW });
assert.equal(r.alerts[0].kind, "building"); assert.equal(r.alerts[0].units, 3);
r = findRepeats([ac({ unit: "Apt 305", daysAgo: 4 }), ac({ unit: "Apt 307", daysAgo: 3 })], { now: NOW });
assert.equal(r.alerts.length, 0);
r = findRepeats([ac({ unit: "Apt 305", daysAgo: 12 }), ac({ unit: "Apt 307", daysAgo: 7 }), ac({ unit: "Apt 112", daysAgo: 1 })], { now: NOW });
assert.ok(!r.alerts.some(a => a.kind === "building"));

// 5. Insights numbers.
n = 0;
const fixedReq = (o, ackH, fixH, first) => {
  let x = req(o); const c = Date.parse(x.createdAt);
  x = applyUpdate(x, { status: "seen" }, iso(c + ackH * H));
  return applyUpdate(x, { status: "fixed", firstVisit: first }, iso(c + fixH * H));
};
const items = [
  fixedReq({ urgency: "Emergency", afterHours: true, daysAgo: 3, blanksLeft: 0, hasPhoto: true }, 0.25, 2, true),
  fixedReq({ urgency: "Urgent", afterHours: true, daysAgo: 5, blanksLeft: 0, hasPhoto: true }, 8, 20, false),
  fixedReq({ urgency: "Routine", afterHours: false, daysAgo: 6, blanksLeft: 2, hasPhoto: true }, 3, 50, true),
  applyUpdate(req({ urgency: "Urgent", afterHours: true, daysAgo: 1, blanksLeft: 0, hasPhoto: false }), { status: "seen", mgrUrgency: "Routine" }, iso(NOW - 20 * H)),
  req({ urgency: "Routine", afterHours: true, daysAgo: 45 }),        // outside 30 days
];
let k = computeInsights(items, { now: NOW, sinceDays: 30 });
assert.equal(k.total, 4); assert.equal(k.open, 1);
assert.equal(k.afterHours, 3); assert.equal(k.couldWait, 2);
assert.equal(k.calloutSavings, null, "no savings without the manager's own cost");
assert.equal(k.emergencies, 1); assert.equal(k.emergencyAckMs, 0.25 * H);
assert.equal(k.fixMs, 20 * H);
assert.equal(k.firstVisitRate, 67); assert.equal(k.returnTrips, 1);
assert.equal(k.completeRate, 50);                                  // 2 of 4 had a photo and no blanks
assert.equal(k.reviewed, 4); assert.equal(k.keptRate, 75);         // one urgency changed by the manager
k = computeInsights(items, { now: NOW, sinceDays: 0, calloutCost: "250", tripCost: 120 });
assert.equal(k.total, 5); assert.equal(k.couldWait, 3); assert.equal(k.calloutSavings, 750); assert.equal(k.returnTripCost, 120);
assert.deepEqual(computeInsights([], { now: NOW }).firstVisitRate, null);

console.log("All insights tests passed");
