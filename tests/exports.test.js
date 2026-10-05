import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, requestsCSV, workOrderText, stamp, CSV_COLUMNS } from "../shared/exports.js";
import { computeInsights } from "../shared/workorders.js";
import { tr } from "../shared/i18n.js";

const r = {
  id: "1", ref: "CW-ABC123", created_at: "2026-10-05T14:30:00Z", property_id: "p", resident_id: "u", unit: "Apt 2",
  category: "Plumbing / Water", urgency: "Urgent", ai_urgency: "Urgent", mgr_urgency: "Emergency", ai_reason: "Slow leak.", title: "Leak, \"bad\"",
  body: "Water drips\nfast", answers: [{ q: "Since?", a: "Tonight" }], location_in_home: "Kitchen", entry_permission: true, entry_notes: "Dog crated",
  access_notes: "=HYPERLINK(\"x\")", has_pets: true, availability: "Evenings, Weekends", status: "new", scheduled_for: null, tech: null,
  first_visit: null, after_hours: true, lang: "es", photo_path: "u/p.jpg", video_path: null, has_photo: true,
};

test("CSV cells are quoted and can't run formulas", () => {
  assert.equal(csvCell('a "b", c'), '"a ""b"", c"');
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell(null), "");
});
test("CSV has a header row, a BOM, and the final urgency as priority", () => {
  const csv = requestsCSV([r], { propName: () => "Peachtree", residentName: () => "Ana", reason: () => "safety", timeZone: "America/New_York" });
  assert.ok(csv.startsWith("﻿Reference,Created,"));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 2); // header + one row (its line break inside quotes is \n, rows end in \r\n)
  assert.ok(csv.includes("2026-10-05 10:30")); assert.ok(csv.includes(",Emergency,Urgent,Urgent,safety,"));
  assert.ok(csv.includes("'=HYPERLINK")); assert.equal(CSV_COLUMNS.length, 26);
});
test("stamp formats in a time zone", () => { assert.equal(stamp("2026-01-15T05:05:00Z", "America/New_York"), "2026-01-15 00:05"); assert.equal(stamp(null), ""); });
test("work order text in English and Spanish", () => {
  const en = workOrderText(r, { property: "Peachtree", resident: "Ana", phone: "404", link: "https://x/m/requests/1" });
  assert.ok(en.startsWith("WORK ORDER CW-ABC123 · EMERGENCY"));
  assert.ok(en.includes("Permission to enter: Yes (Dog crated)")); assert.ok(en.includes("Best times: Evenings, Weekends"));
  const es = workOrderText(r, { property: "Peachtree", link: "https://x" }, (s, v) => tr("es", s, v));
  assert.ok(es.startsWith("ORDEN DE TRABAJO CW-ABC123 · EMERGENCIA"));
  assert.ok(es.includes("Permiso para entrar: Sí")); assert.ok(es.includes("Noches, Fines de semana")); assert.ok(es.includes("Cocina"));
});
test("AI accuracy counts under- and over-calls and change reasons", () => {
  const base = { created_at: new Date().toISOString(), property_id: "p", unit: "1", category: "Other", manual_review: false, after_hours: false, blanks_left: 0, has_photo: true, first_visit: null, status: "acknowledged" };
  const items = [
    { ...base, id: "a", urgency: "Urgent", ai_urgency: "Urgent", mgr_urgency: "Emergency" },
    { ...base, id: "b", urgency: "Urgent", ai_urgency: "Urgent", mgr_urgency: "Routine" },
    { ...base, id: "c", urgency: "Routine", ai_urgency: "Routine", mgr_urgency: null },
  ];
  const ev = { a: [{ kind: "urgency", status: null, created_at: base.created_at, detail: { reason: "safety" } }], b: [{ kind: "urgency", status: null, created_at: base.created_at, detail: { reason: "minor" } }] };
  const k = computeInsights(items, ev, {});
  assert.equal(k.aiUnder, 1); assert.equal(k.aiOver, 1); assert.deepEqual(k.aiUnderIds, ["a"]);
  assert.equal(k.reasons.safety, 1); assert.equal(k.reasons.minor, 1); assert.equal(k.keptRate, 33);
});
