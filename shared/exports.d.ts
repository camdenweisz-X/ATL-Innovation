export const CSV_COLUMNS: string[];
export function csvCell(v: unknown): string;
export function stamp(iso: string | null | undefined, timeZone?: string): string;
export function requestsCSV(rows: unknown[], ctx?: {
  propName?: (id: string | null) => string; residentName?: (id: string) => string; reason?: (id: string) => string; timeZone?: string;
}): string;
export function workOrderText(r: unknown, ctx: { property?: string; resident?: string; phone?: string | null; link?: string; when?: string },
  t?: (s: string, vars?: Record<string, string | number>) => string): string;
