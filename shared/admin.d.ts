export interface AdminAccount {
  id: string; short_id: string; email: string; method: string; joined: string; last_sign_in: string | null; last_active: string;
  set_up: boolean; lang: string; roles: string[]; requests: number; checks_24h: number;
}
export interface AdminEvent { at: string; user_id: string | null; type: "signup" | "signin" | "property" | "join" | "home" | "request" | "update" | "message" | "ai"; text: string }
export interface AdminSummary {
  accounts: number; new_7d: number; active_7d: number; set_up: number; properties: number; requests: number; requests_7d: number;
  checks_24h: number; ai_kept_rate: number | null; ai_judged: number;
}
export interface AdminReport { generated_at: string; summary: AdminSummary; accounts: AdminAccount[]; feed: AdminEvent[] }
export function maskEmail(email: string | null | undefined): string;
export function parseAdminEmails(raw: string | null | undefined): string[];
export function isAdmin(user: { email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null } | null | undefined, adminEmails: string[]): boolean;
export function buildAdminReport(d: Record<string, unknown[]>, now?: number): AdminReport;
