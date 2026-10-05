import type { Urgency } from "./triage.js";
export interface WOItem {
  id: string; created_at: string; property_id: string | null; unit: string | null; category: string; status: string;
  urgency: Urgency; ai_urgency: Urgency | null; mgr_urgency: Urgency | null; manual_review: boolean;
  after_hours: boolean; blanks_left: number; has_photo: boolean; first_visit: boolean | null;
}
export interface WOEvent { kind: string; status: string | null; created_at: string }
export interface RepeatAlert {
  kind: "unit" | "building"; level: "high" | "watch"; property_id: string | null; unit?: string | null; category: string;
  count: number; days: number; ids: string[]; last: string; units?: number; unitNames?: string[];
}
export function finalUrgency(r: { urgency: Urgency; mgr_urgency: Urgency | null }): Urgency;
export function seenAt(events: WOEvent[]): number | null;
export function fixedAt(events: WOEvent[]): number | null;
export function findRepeats(items: WOItem[], opts?: { now?: number; unitDays?: number; buildingDays?: number; buildingUnits?: number }):
  { alerts: RepeatAlert[]; byId: Record<string, { nth?: number; count?: number; days?: number; building?: number }> };
export interface Insights {
  total: number; open: number; afterHours: number; couldWait: number; calloutSavings: number | null;
  emergencies: number; emergencyAckMs: number | null; fixed: number; fixMs: number | null;
  firstVisitRate: number | null; returnTrips: number; returnTripCost: number | null;
  completeRate: number | null; keptRate: number | null; reviewed: number; byCategory: [string, number][];
}
export function computeInsights(items: WOItem[], eventsById: Record<string, WOEvent[]>, opts?: { now?: number; sinceDays?: number; calloutCost?: number | string; tripCost?: number | string }): Insights;
