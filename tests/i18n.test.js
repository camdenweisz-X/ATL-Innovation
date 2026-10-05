// Every English string the app translates must have a Spanish entry in shared/es.js, with the same {placeholders}.
// Finds t("…"), tt("…"), tx("…"), tn(n, "…", "…"), tr(lang, "…"), trn(lang, n, "…", "…") and arrays/objects marked /* i18n */.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { ES } from "../shared/es.js";
import { CATEGORIES, SAFETY_QS, STATUS_LABEL, LEVELS, URGENCY_REASONS } from "../shared/triage.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
function files(dir, out = []) {
  for (const f of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) files(p, out);
    else if (/\.(tsx?|js)$/.test(f.name) && !/\.d\.ts$/.test(f.name) && f.name !== "es.js") out.push(p);
  }
  return out;
}
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const unq = (s) => JSON.parse(`"${s}"`);

export function collectKeys() {
  const keys = new Set();
  for (const f of [...files("src"), ...files("shared"), ...files("api")]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of src.matchAll(new RegExp(String.raw`\b(?:t|tt|tx)\(\s*${STR}`, "g"))) keys.add(unq(m[1]));
    for (const m of src.matchAll(new RegExp(String.raw`\btr\(\s*[\w.]+\s*,\s*${STR}`, "g"))) keys.add(unq(m[1]));
    for (const m of src.matchAll(new RegExp(String.raw`\btn\(\s*[^,]+,\s*${STR}\s*,\s*${STR}`, "g"))) { keys.add(unq(m[1])); keys.add(unq(m[2])); }
    for (const m of src.matchAll(new RegExp(String.raw`\btrn\(\s*[\w.]+\s*,\s*[^,]+,\s*${STR}\s*,\s*${STR}`, "g"))) { keys.add(unq(m[1])); keys.add(unq(m[2])); }
    // Blocks marked /* i18n */: every string literal inside the following [...] or {...}, except code-like single words.
    for (const m of src.matchAll(/\/\* i18n \*\/\s*([[{])/g)) {
      const open = m[1], close = open === "[" ? "]" : "}";
      let depth = 0, i = m.index + m[0].length - 1, end = i;
      for (; i < src.length; i++) { if (src[i] === open) depth++; else if (src[i] === close && --depth === 0) { end = i; break; } }
      for (const s of src.slice(m.index, end).matchAll(new RegExp(STR, "g"))) { const v = unq(s[1]); if (!/^[a-z_]+$/.test(v)) keys.add(v); }
    }
  }
  // Values that come from shared lists and are translated at display time.
  for (const v of [...CATEGORIES, ...SAFETY_QS.map((s) => s.q), ...Object.values(STATUS_LABEL), ...LEVELS, ...URGENCY_REASONS.map((r) => r.label), "New", "Seen"]) keys.add(v);
  return [...keys].filter((k) => /[A-Za-z]/.test(k));
}

const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every translated string has Spanish", () => {
  const missing = collectKeys().filter((k) => !Object.prototype.hasOwnProperty.call(ES, k));
  const out = path.join(root, "tests", ".missing-es.json");
  if (missing.length) fs.writeFileSync(out, JSON.stringify(missing, null, 2)); else fs.rmSync(out, { force: true });
  assert.deepEqual(missing, [], `${missing.length} strings have no Spanish (listed in tests/.missing-es.json)`);
});

test("Spanish keeps the same placeholders", () => {
  const bad = Object.entries(ES).filter(([k, v]) => holes(k) !== holes(v)).map(([k]) => k);
  assert.deepEqual(bad, []);
});

test("no empty Spanish entries", () => {
  assert.deepEqual(Object.entries(ES).filter(([, v]) => !String(v).trim()).map(([k]) => k), []);
});
