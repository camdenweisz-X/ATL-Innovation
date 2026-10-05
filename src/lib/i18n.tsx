import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { tr, trn, normLang, LOCALE, type Lang } from "../../shared/i18n.js";
import { local } from "./store";

export type { Lang };
type Vars = Record<string, string | number | null | undefined>;

/** First visit: the browser's language. After that, whatever the person picked (saved on the device and on their profile). */
function initialLang(): Lang {
  const saved = local.get<string | null>("cw_lang", null);
  if (saved) return normLang(saved);
  return typeof navigator !== "undefined" && /^es\b/i.test(navigator.language || "") ? "es" : "en";
}

let current: Lang = initialLang();
/** The language in use, for code outside React components (formatting, error messages). */
export const getLang = (): Lang => current;
export const locale = (): string => LOCALE[current];
/** Translate outside components. Inside components use `useT()` so the screen updates when the language changes. */
export const tt = (s: string, vars?: Vars): string => tr(current, s, vars);

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (s: string, vars?: Vars) => string;
  tn: (n: number, one: string, many: string, vars?: Vars) => string;
  /** Like t, but placeholders can be React elements (links, bold text). */
  tx: (s: string, vars: Record<string, ReactNode>) => ReactNode;
}
const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setL] = useState<Lang>(current);
  const setLang = useCallback((l: Lang) => {
    const n = normLang(l);
    current = n; local.set("cw_lang", n); setL(n);
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo<Ctx>(() => ({
    lang, setLang,
    t: (s, vars) => tr(lang, s, vars),
    tn: (n, one, many, vars) => trn(lang, n, one, many, vars),
    tx: (s, vars) => tr(lang, s).split(/(\{\w+\})/).map((part, i) => {
      const m = part.match(/^\{(\w+)\}$/);
      return <Fragment key={i}>{m && m[1] in vars ? vars[m[1]] : part}</Fragment>;
    }),
  }), [lang, setLang]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useT(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error("useT outside LangProvider");
  return c;
}
