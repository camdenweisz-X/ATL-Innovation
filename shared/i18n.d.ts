export type Lang = "en" | "es";
export const LANGS: Lang[];
export const LANG_NAMES: Record<Lang, string>;
export const LOCALE: Record<Lang, string>;
export function normLang(l: unknown): Lang;
export function tr(lang: Lang, s: string, vars?: Record<string, string | number | null | undefined>): string;
export function trn(lang: Lang, n: number, one: string, many: string, vars?: Record<string, string | number | null | undefined>): string;
