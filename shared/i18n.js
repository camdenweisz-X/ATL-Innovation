// Translation helpers shared by the app (src/) and the server functions (api/).
// English text is the key; shared/es.js maps it to Spanish. Anything missing falls back to English,
// and tests/i18n.test.js fails the build if a string used in the app has no Spanish entry.
import { ES } from "./es.js";

export const LANGS = ["en", "es"];
export const LANG_NAMES = { en: "English", es: "Español" };
export const LOCALE = { en: "en-US", es: "es-US" };

export const normLang = (l) => (l === "es" ? "es" : "en");

/** Translate `s` into `lang`, filling {placeholders} from `vars`. */
export function tr(lang, s, vars) {
  let out = lang === "es" && Object.prototype.hasOwnProperty.call(ES, s) ? ES[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
  return out;
}

/** Singular/plural: `trn("es", 3, "{n} request", "{n} requests")`. */
export function trn(lang, n, one, many, vars) {
  return tr(lang, n === 1 ? one : many, { n, ...(vars || {}) });
}
