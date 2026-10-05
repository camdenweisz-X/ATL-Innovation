import { local } from "./store";
/** Light is the default. Dark mode is only on when the person turns it on in Settings. */
export type ThemePref = "light" | "dark";
export function getTheme(): ThemePref { return local.get<string>("fc_theme", "light") === "dark" ? "dark" : "light"; }
export function applyTheme(pref: ThemePref = getTheme()) {
  const dark = pref === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e1318" : "#f4f5f7");
}
export function setTheme(pref: ThemePref) { local.set("fc_theme", pref); applyTheme(pref); }
