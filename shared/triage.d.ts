export type Urgency = "Routine" | "Urgent" | "Emergency";
export type Status = "new" | "acknowledged" | "scheduled" | "in_progress" | "resolved" | "canceled";
export interface Triage {
  urgency: Urgency;
  reason: string;
  safety_message: string;
  until_fixed: string[];
  category: string;
  title: string;
  request: string;
  questions: string[];
  photo_notes: string;
}
export const LEVELS: Urgency[];
export const RANK: Record<Urgency, number>;
export const CATEGORIES: string[];
export const SAFETY_QS: { k: string; q: string }[];
export const STATUS_LABEL: Record<Status, string>;
export function buildPrompt(inp: {
  description: string; checklist: Record<string, string | undefined>; localTime: string;
  afterHours: boolean; hasPhoto: boolean; locationInHome?: string;
}): string;
export function normalizeAI(d: unknown): Triage;
export function parseModelJSON(text: string): unknown;
