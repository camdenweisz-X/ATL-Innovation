import { local } from "./store";
export type ThemePref = "system" | "light" | "dark";
export function getTheme(): ThemePref { return local.get<ThemePref>("fc_theme", "system"); }
export function applyTheme(pref: ThemePref = getTheme()) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e1318" : "#f4f5f7");
}
export function setTheme(pref: ThemePref) { local.set("fc_theme", pref); applyTheme(pref); }
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());
