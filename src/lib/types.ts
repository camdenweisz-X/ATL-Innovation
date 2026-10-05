import type { Status, Urgency } from "../../shared/triage.js";
export type { Status, Urgency };

export interface Profile { id: string; full_name: string; phone: string | null; notify_email: boolean; notify_sms: boolean; onboarded: boolean; lang: "en" | "es"; }
export interface Property { id: string; name: string; address: string | null; after_hours_phone: string | null; created_at: string; }
export interface Membership { id: string; property_id: string; user_id: string; role: "manager" | "resident"; unit: string | null; created_at: string; property?: Property; }
export interface ExternalPlace {
  id: string; user_id: string; label: string; unit: string | null; contact_name: string | null;
  contact_email: string | null; contact_phone: string | null; after_hours_phone: string | null; created_at: string;
}
export interface RequestRow {
  id: string; ref: string; resident_id: string; property_id: string | null; external_place_id: string | null; unit: string | null;
  title: string; category: string; urgency: Urgency; ai_urgency: Urgency | null; ai_reason: string | null; safety_flags: string[];
  description: string | null; body: string; answers: { q: string; a: string }[]; location_in_home: string | null;
  entry_permission: boolean | null; entry_notes: string | null; has_pets: boolean | null; availability: string | null;
  photo_path: string | null; manual_review: boolean; status: Status; created_at: string; updated_at: string;
  after_hours: boolean; blanks_left: number; has_photo: boolean;
  scheduled_for: string | null; tech: string | null; first_visit: boolean | null; mgr_urgency: Urgency | null;
  lang: "en" | "es"; video_path: string | null; access_notes: string | null; alerted_at: string | null; escalated_at: string | null;
}
export type UrgencyReason = "safety" | "minor" | "clarified" | "other";
export interface RequestEvent {
  id: string; request_id: string; actor_id: string | null; kind: "created" | "status" | "message" | "urgency" | "escalated"; status: Status | null;
  body: string | null; created_at: string;
  detail: {
    scheduled_for?: string; tech?: string; first_visit?: boolean; urgency?: Urgency; from?: Urgency; reason?: UrgencyReason; note?: string;
    after_min?: number; backup?: string | null; backup_reached?: boolean;
  } | null;
}
export interface PropertySettings {
  property_id: string; backup_name: string | null; backup_phone: string | null; backup_email: string | null;
  escalate_after_min: number; forward_email: string | null;
}

/** A place a resident can report for: a CanItWait property (membership) or an outside landlord. */
export type Place =
  | { kind: "property"; key: string; membership: Membership; property: Property; label: string; unit: string | null }
  | { kind: "external"; key: string; place: ExternalPlace; label: string; unit: string | null };
