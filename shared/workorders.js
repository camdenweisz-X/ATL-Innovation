// Work-order math for the manager's Inbox and Insights: repeat problems and performance numbers.
// Pure functions (no database calls), shared by the app and the tests.

const DAY_MS = 864e5;
const SEEN = ["acknowledged", "scheduled", "in_progress", "resolved"];

export const finalUrgency = (r) => r.mgr_urgency || r.urgency;
const tOf = (r) => Date.parse(r.created_at) || 0;
const unitKey = (r) => (String(r.property_id || "") + "|" + String(r.unit || "")).toLowerCase().replace(/[^a-z0-9|-]/g, "");

/** First time maintenance reacted (seen, scheduled, started or fixed), from the request's status events. */
export function seenAt(events) {
  const t = (events || []).filter((e) => e.kind === "status" && SEEN.includes(e.status)).map((e) => Date.parse(e.created_at)).filter(Boolean);
  return t.length ? Math.min(...t) : null;
}
/** First time it was marked fixed. */
export function fixedAt(events) {
  const t = (events || []).filter((e) => e.kind === "status" && e.status === "resolved").map((e) => Date.parse(e.created_at)).filter(Boolean);
  return t.length ? Math.min(...t) : null;
}
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Repeat problems: the same unit reporting the same category 2+ times within `unitDays` (3+ = "high"),
 * and possible building-wide issues: the same category from `buildingUnits`+ different units within `buildingDays`.
 */
export function findRepeats(items, opts = {}) {
  const now = opts.now ?? Date.now(), unitDays = opts.unitDays ?? 60, bDays = opts.buildingDays ?? 7, bUnits = opts.buildingUnits ?? 3;
  const alerts = [], byId = {};
  const groups = new Map();
  for (const i of items) {
    if (!i.unit || i.status === "canceled" || now - tOf(i) > unitDays * DAY_MS) continue;
    const k = unitKey(i) + "#" + i.category;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => tOf(a) - tOf(b));
    const span = Math.max(1, Math.ceil((tOf(list[list.length - 1]) - tOf(list[0])) / DAY_MS));
    alerts.push({ kind: "unit", level: list.length >= 3 ? "high" : "watch", property_id: list[0].property_id, unit: list[0].unit, category: list[0].category,
      count: list.length, days: span, ids: list.map((i) => i.id), last: list[list.length - 1].created_at });
    list.forEach((i, n) => { byId[i.id] = { ...(byId[i.id] || {}), nth: n + 1, count: list.length, days: span }; });
  }
  const cats = new Map();
  for (const i of items) {
    if (i.status === "canceled" || now - tOf(i) > Math.max(bDays, 1) * 2 * DAY_MS) continue;
    const k = String(i.property_id || "") + "#" + i.category;
    if (!cats.has(k)) cats.set(k, []);
    cats.get(k).push(i);
  }
  for (const list of cats.values()) {
    list.sort((a, b) => tOf(b) - tOf(a));
    for (let s = 0; s < list.length; s++) {
      const win = list.filter((i) => tOf(i) <= tOf(list[s]) && tOf(list[s]) - tOf(i) <= bDays * DAY_MS);
      const units = new Set(win.filter((i) => i.unit).map(unitKey));
      if (units.size >= bUnits) {
        const span = Math.max(1, Math.ceil((tOf(win[0]) - tOf(win[win.length - 1])) / DAY_MS));
        alerts.push({ kind: "building", level: "high", property_id: list[0].property_id, category: list[0].category, units: units.size, count: win.length, days: span,
          unitNames: [...new Set(win.map((i) => i.unit).filter(Boolean))], ids: win.map((i) => i.id), last: win[0].created_at });
        win.forEach((i) => { byId[i.id] = { ...(byId[i.id] || {}), building: units.size }; });
        break;
      }
    }
  }
  const rank = (a) => (a.kind === "building" ? 0 : a.level === "high" ? 1 : 2);
  alerts.sort((a, b) => rank(a) - rank(b) || String(b.last).localeCompare(String(a.last)));
  return { alerts, byId };
}

/**
 * Numbers for the Insights screen. `eventsById` maps request id → its events.
 * Costs are the manager's own figures; no savings are claimed when they are blank.
 */
export function computeInsights(items, eventsById, opts = {}) {
  const now = opts.now ?? Date.now(), since = opts.sinceDays || 0;
  const list = items.filter((i) => i.status !== "canceled" && (!since || now - tOf(i) <= since * DAY_MS));
  const ev = (i) => eventsById[i.id] || [];
  const after = list.filter((i) => i.after_hours);
  const couldWait = after.filter((i) => finalUrgency(i) !== "Emergency");
  const emerg = list.filter((i) => finalUrgency(i) === "Emergency");
  const emergAck = emerg.map((i) => { const s = seenAt(ev(i)); return s && s - tOf(i); }).filter((x) => x > 0);
  const fixed = list.filter((i) => i.status === "resolved");
  const fixTimes = fixed.map((i) => { const f = fixedAt(ev(i)); return f && f - tOf(i); }).filter((x) => x > 0);
  const visitKnown = fixed.filter((i) => typeof i.first_visit === "boolean");
  const returnTrips = visitKnown.filter((i) => !i.first_visit).length;
  const complete = list.filter((i) => i.blanks_left === 0 && i.has_photo).length;
  const reviewed = list.filter((i) => i.ai_urgency && !i.manual_review && i.status !== "new");
  const kept = reviewed.filter((i) => finalUrgency(i) === i.ai_urgency).length;
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
  const callout = Number(opts.calloutCost) || 0, trip = Number(opts.tripCost) || 0;
  const byCat = {};
  for (const i of list) byCat[i.category] = (byCat[i.category] || 0) + 1;
  return {
    total: list.length, open: list.filter((i) => i.status !== "resolved").length,
    afterHours: after.length, couldWait: couldWait.length, calloutSavings: callout ? couldWait.length * callout : null,
    emergencies: emerg.length, emergencyAckMs: median(emergAck),
    fixed: fixed.length, fixMs: median(fixTimes),
    firstVisitRate: pct(visitKnown.length - returnTrips, visitKnown.length), returnTrips, returnTripCost: trip ? returnTrips * trip : null,
    completeRate: pct(complete, list.length),
    keptRate: pct(kept, reviewed.length), reviewed: reviewed.length,
    byCategory: Object.entries(byCat).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}
