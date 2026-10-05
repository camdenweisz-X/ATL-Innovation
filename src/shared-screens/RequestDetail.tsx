import { useCallback, useEffect, useId, useRef, useState } from "react";
import { STATUS_LABEL } from "../../shared/triage.js";
import { finalUrgency } from "../../shared/workorders.js";
import { supabase, friendly, PHOTO_BUCKET } from "../lib/supabase";
import { useSession } from "../lib/session";
import { notify } from "../lib/api";
import { agoLong, when, telHref, visitTime, ordinal, plural, toLocalInput } from "../lib/format";
import type { RequestEvent, RequestRow, Status, Urgency } from "../lib/types";
import { Button, Field, Sheet, Skeleton, StatusBadge, UrgencyBadge, useToast, Empty, YesNo } from "../ui/kit";
import { Icon, type IconName } from "../ui/icons";

interface PersonMap { [id: string]: string }
export interface RepeatInfo { nth?: number; count?: number; days?: number; building?: number }
type Action = { s: Status; label: string };

const NEXT: Record<Status, Action[]> = {
  new: [{ s: "acknowledged", label: "Mark as seen" }, { s: "scheduled", label: "Schedule visit" }, { s: "resolved", label: "Mark fixed" }],
  acknowledged: [{ s: "scheduled", label: "Schedule visit" }, { s: "in_progress", label: "Start work" }, { s: "resolved", label: "Mark fixed" }],
  scheduled: [{ s: "resolved", label: "Mark fixed" }, { s: "in_progress", label: "Start work" }, { s: "scheduled", label: "Reschedule" }],
  in_progress: [{ s: "resolved", label: "Mark fixed" }, { s: "scheduled", label: "Schedule return visit" }],
  resolved: [{ s: "acknowledged", label: "Reopen" }],
  canceled: [{ s: "acknowledged", label: "Reopen" }],
};

function eventText(e: RequestEvent): { text: string; icon: IconName } {
  if (e.kind === "created") return { text: "sent the request", icon: "send" };
  if (e.kind === "urgency") return { text: `changed the urgency to ${e.detail?.urgency ?? ""}`.trim(), icon: "alert" };
  if (e.kind === "message") return { text: "", icon: "message" };
  const label = STATUS_LABEL[e.status as Status]?.toLowerCase() || "updated";
  if (e.status === "scheduled") return { text: e.detail?.scheduled_for ? `scheduled a visit for ${visitTime(e.detail.scheduled_for)}${e.detail.tech ? ` with ${e.detail.tech}` : ""}` : "scheduled a visit", icon: "calendar" };
  if (e.status === "resolved") return { text: `marked it fixed${e.detail?.first_visit === false ? " (took more than one visit)" : e.detail?.first_visit ? " on the first visit" : ""}`, icon: "check" };
  return { text: `marked it ${label}`, icon: "check" };
}

export function RequestDetail({ id, mode, repeat }: { id: string; mode: "resident" | "manager"; repeat?: RepeatInfo }) {
  const { user, memberships, externalPlaces } = useSession();
  const toast = useToast();
  const [req, setReq] = useState<RequestRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [people, setPeople] = useState<PersonMap>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState<Action | "urgency" | null>(null);
  const [note, setNote] = useState("");
  const [visit, setVisit] = useState("");
  const [tech, setTech] = useState("");
  const [firstVisit, setFirstVisit] = useState<boolean | null>(null);
  const [urgPick, setUrgPick] = useState<Urgency>("Urgent");
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const msgId = useId();

  const load = useCallback(async () => {
    const [{ data: r }, { data: ev }] = await Promise.all([
      supabase.from("requests").select("*").eq("id", id).maybeSingle(),
      supabase.from("request_events").select("*").eq("request_id", id).order("created_at"),
    ]);
    if (!r) { setMissing(true); return; }
    setReq(r as RequestRow); setEvents((ev as RequestEvent[]) || []);
    const ids = Array.from(new Set([(r as RequestRow).resident_id, ...((ev as RequestEvent[]) || []).map((e) => e.actor_id).filter(Boolean)])) as string[];
    const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    setPeople(Object.fromEntries((ps || []).map((p) => [p.id, p.full_name || "Someone"])));
  }, [id]);

  useEffect(() => { setReq(null); setMissing(false); setPhotoUrl(null); void load(); }, [load]);
  useEffect(() => {
    if (!req?.photo_path) return;
    supabase.storage.from(PHOTO_BUCKET).createSignedUrl(req.photo_path, 3600).then(({ data }) => setPhotoUrl(data?.signedUrl || null));
  }, [req?.photo_path]);
  useEffect(() => {
    const ch = supabase.channel(`req-${id}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "request_events", filter: `request_id=eq.${id}` }, () => void load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "requests", filter: `id=eq.${id}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [id, load]);

  if (missing) return <div className="page"><Empty icon="info" title="Request not found">It may have been deleted, or you no longer have access to it.</Empty></div>;
  if (!req) return <div className="card pad"><Skeleton h={28} n={6} /></div>;

  const membership = memberships.find((m) => m.property_id === req.property_id);
  const ext = externalPlaces.find((e) => e.id === req.external_place_id);
  const placeName = membership?.property?.name || ext?.label || "Your home";
  const isOpen = !["resolved", "canceled"].includes(req.status);
  const canMessage = !!req.property_id;
  const residentName = people[req.resident_id] || "Resident";
  const level = finalUrgency(req);
  const lastEvent = (kind: string) => [...events].reverse().find((e) => e.kind === kind);

  const openSheet = (a: Action | "urgency") => {
    setNote(""); setFirstVisit(null);
    if (a !== "urgency" && a.s === "scheduled") {
      const d = req.scheduled_for ? new Date(req.scheduled_for) : (() => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); return t; })();
      setVisit(toLocalInput(d)); setTech(req.tech || "");
    }
    if (a === "urgency") setUrgPick(level);
    setSheet(a);
  };

  const sendMsg = async () => {
    const body = msg.trim(); if (!body) return;
    setSending(true);
    const { data, error } = await supabase.from("request_events").insert({ request_id: req.id, kind: "message", body }).select("id").single();
    setSending(false);
    if (error) return toast(friendly(error), "error");
    setMsg(""); notify(data.id); void load();
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 100);
  };

  const saveStatus = async (a: Action) => {
    if (a.s === "scheduled" && !visit) return toast("Pick a visit date and time.", "error");
    setSaving(true);
    const { error } = await supabase.rpc("set_request_status", {
      p_request: req.id, p_status: a.s, p_note: note.trim() || null,
      p_scheduled_for: a.s === "scheduled" ? new Date(visit).toISOString() : null,
      p_tech: a.s === "scheduled" ? tech.trim() || null : null,
      p_first_visit: a.s === "resolved" ? firstVisit : null,
    });
    setSaving(false);
    if (error) return toast(friendly(error), "error");
    setSheet(null);
    toast(a.s === "scheduled" ? "Visit scheduled" : `Marked ${STATUS_LABEL[a.s].toLowerCase()}`);
    const { data: ev } = await supabase.from("request_events").select("id").eq("request_id", req.id).eq("kind", "status").eq("actor_id", user!.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    notify(ev?.id); void load();
  };
  const saveUrgency = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("set_request_urgency", { p_request: req.id, p_urgency: urgPick });
    setSaving(false);
    if (error) return toast(friendly(error), "error");
    setSheet(null); toast(`Urgency set to ${urgPick}`); void load();
  };

  const actions: Action[] = mode === "manager" ? NEXT[req.status]
    : !isOpen ? []
    : ext ? [{ s: "resolved", label: "It's fixed" }, { s: "canceled", label: "Cancel request" }]
    : [...(["scheduled", "in_progress"].includes(req.status) ? [{ s: "resolved" as Status, label: "It's fixed" }] : []),
       ...(["new", "acknowledged"].includes(req.status) ? [{ s: "canceled" as Status, label: "Cancel request" }] : [])];
  const sheetAction = sheet && sheet !== "urgency" ? sheet : null;
  const urgEvent = lastEvent("urgency");

  return (
    <div className="stack-lg">
      <header className="stack-sm">
        <div className="row-wrap">
          <UrgencyBadge u={level} /><StatusBadge s={req.status} manager={mode === "manager"} />
          {req.manual_review && <span className="badge flag">Needs manual review</span>}
          {req.mgr_urgency && <span className="badge flag">{mode === "manager" ? "Urgency changed by your team" : "Urgency updated by maintenance"}</span>}
          {mode === "manager" && !req.mgr_urgency && req.ai_urgency && req.ai_urgency !== req.urgency && <span className="badge warn">Resident changed from {req.ai_urgency}</span>}
          {mode === "manager" && repeat?.count && <span className="badge warn"><Icon name="refresh" />Repeat · {ordinal(repeat.nth || 1)} of {repeat.count} in {plural(repeat.days || 1, "day")}</span>}
          {mode === "manager" && repeat?.building && <span className="badge warn"><Icon name="building" />{repeat.building} units, same problem</span>}
        </div>
        <h1 className="h1" style={{ fontSize: 24 }}>{req.title}</h1>
        <div className="small muted">{mode === "manager" ? `${residentName} · ` : ""}{placeName}{req.unit ? ` · ${req.unit}` : ""} · <span className="mono">{req.ref}</span></div>
      </header>

      {mode === "manager" && level === "Emergency" && isOpen && (
        <div className="notice warn"><Icon name="alert" /><div><b>Emergency.</b> Reported {agoLong(req.created_at)}. Contact the resident now.</div></div>
      )}

      {req.status === "scheduled" && req.scheduled_for && (
        <div className="notice info"><Icon name="calendarCheck" /><div><b>Visit {visitTime(req.scheduled_for)}</b>{req.tech ? ` · ${req.tech}` : ""}
          {mode === "resident" && lastEvent("status")?.body && <div className="small" style={{ marginTop: 4 }}>“{lastEvent("status")?.body}”</div>}</div></div>
      )}

      {actions.length > 0 && (
        <div className="row-wrap">
          {actions.map((a, i) => <Button key={a.label} size="sm" variant={i === 0 ? "primary" : a.s === "canceled" ? "danger-outline" : "secondary"} onClick={() => openSheet(a)}>{a.label}</Button>)}
          {mode === "manager" && isOpen && <Button size="sm" variant="ghost" icon="alert" onClick={() => openSheet("urgency")}>Change urgency</Button>}
        </div>
      )}

      {photoUrl && <button type="button" onClick={() => setZoom(true)} aria-label="Enlarge photo" style={{ border: 0, padding: 0, background: "none", cursor: "zoom-in" }}><img className="photo-hero" src={photoUrl} alt="Photo of the problem" /></button>}

      <section className="card pad stack">
        <div className="body-text">{req.body}</div>
        {req.answers?.length > 0 && <div className="stack-sm">{req.answers.map((a) => <div key={a.q} className="small"><span className="muted">{a.q}</span><br />{a.a}</div>)}</div>}
        <dl className="facts" style={{ margin: 0 }}>
          <div><dt>Category</dt><dd>{req.category}</dd></div>
          <div><dt>Reported</dt><dd>{when(req.created_at)}{req.after_hours ? " · after hours" : ""}</dd></div>
          {req.location_in_home && <div><dt>Where</dt><dd>{req.location_in_home}</dd></div>}
          <div><dt>Entry if not home</dt><dd className="row" style={{ gap: 6 }}>{req.entry_permission === null ? "Not answered" : <><Icon name={req.entry_permission ? "unlock" : "lock"} width={16} height={16} style={{ color: req.entry_permission ? "var(--rout)" : "var(--emer)" }} />{req.entry_permission ? "Allowed" : "Not allowed"}</>}</dd></div>
          {req.has_pets !== null && <div><dt>Pets</dt><dd>{req.has_pets ? "Yes" : "No"}</dd></div>}
          {req.availability && <div><dt>Best times</dt><dd>{req.availability}</dd></div>}
          {req.status === "resolved" && req.first_visit !== null && <div><dt>Visits</dt><dd>{req.first_visit ? "Fixed on the first visit" : "Took more than one visit"}</dd></div>}
        </dl>
        {req.entry_notes && <div className="small"><span className="muted">Entry notes: </span>{req.entry_notes}</div>}
        {req.ai_reason && <div className="small muted" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}><Icon name="sparkle" width={14} height={14} style={{ verticalAlign: -2 }} /> AI check{req.ai_urgency ? ` (${req.ai_urgency})` : ""}: {req.ai_reason}</div>}
        {req.mgr_urgency && urgEvent && <div className="small muted">Urgency changed from {req.urgency} to {req.mgr_urgency} {agoLong(urgEvent.created_at)}.</div>}
      </section>

      {mode === "resident" && ext && (
        <section className="card pad stack-sm">
          <h2 className="h3">Sent outside CanItWait</h2>
          <p className="small muted" style={{ margin: 0 }}>Your landlord doesn't use CanItWait, so updates won't appear here. Contact them directly, and mark it fixed here when it's done.</p>
          <div className="row-wrap">{ext.contact_email && <a className="btn secondary sm" href={`mailto:${ext.contact_email}`}><Icon name="mail" />Email</a>}
            {ext.contact_phone && <a className="btn secondary sm" href={telHref(ext.contact_phone)}><Icon name="phone" />Call</a>}</div>
        </section>
      )}

      {canMessage && (
        <section className="stack">
          <h2 className="h2">Activity</h2>
          <ol className="timeline">
            {events.map((e) => {
              const who = e.actor_id === user?.id ? "You" : people[e.actor_id || ""] || (mode === "resident" ? "Maintenance" : "Someone");
              const t = eventText(e);
              const showBody = e.body && e.kind !== "urgency";
              return (
                <li key={e.id}>
                  <span className={`node ${e.kind !== "message" ? "st" : ""}`}><Icon name={t.icon} /></span>
                  <div className="grow">
                    <div className="small"><b>{who}</b> <span className="muted">{t.text}{t.text ? " · " : ""}{agoLong(e.created_at)}</span></div>
                    {showBody && <div className={`bubble ${e.actor_id === user?.id ? "mine" : ""}`}>{e.body}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
          <div ref={endRef} />
          <div className="composer">
            <label htmlFor={msgId} style={{ position: "absolute", left: -9999 }}>Message</label>
            <textarea id={msgId} className="textarea" rows={1} placeholder={mode === "manager" ? `Message ${residentName}…` : "Message maintenance…"} value={msg} onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendMsg(); }} />
            <Button icon="send" loading={sending} disabled={!msg.trim()} onClick={sendMsg} aria-label="Send message" />
          </div>
        </section>
      )}

      <Sheet open={!!sheetAction} onClose={() => setSheet(null)} title={sheetAction?.label}>
        {sheetAction && (
          <div className="stack">
            {sheetAction.s === "scheduled" && (<>
              <Field label="Visit date and time" htmlFor="wo-when"><input id="wo-when" className="input" type="datetime-local" value={visit} onChange={(e) => setVisit(e.target.value)} /></Field>
              <Field label="Technician" optional htmlFor="wo-tech"><input id="wo-tech" className="input" placeholder="Marcus" value={tech} onChange={(e) => setTech(e.target.value)} /></Field>
            </>)}
            {sheetAction.s === "resolved" && mode === "manager" && (
              <div className="between"><span id="fv-lbl" style={{ fontWeight: 600 }}>Fixed on the first visit?</span><YesNo neutral labelledBy="fv-lbl" value={firstVisit} onChange={setFirstVisit} /></div>
            )}
            {sheetAction.s === "resolved" && mode === "manager" && <p className="hint" style={{ margin: "-8px 0 0" }}>Feeds the first-visit fix rate in Insights.</p>}
            <p className="muted" style={{ margin: 0 }}>{sheetAction.s === "canceled" ? "Maintenance will see that you canceled it." : ext && mode === "resident" ? "This only updates your own list." : `The ${mode === "manager" ? "resident" : "manager"} gets an update.`}</p>
            <div className="field"><label className="label" htmlFor="status-note">{sheetAction.s === "scheduled" ? "Note to the resident" : "Note"} <span className="opt">(optional)</span></label>
              <textarea id="status-note" className="textarea" placeholder={sheetAction.s === "scheduled" ? "We'll check the unit above yours too." : "Add details"} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button block loading={saving} variant={sheetAction.s === "canceled" ? "danger" : "primary"} onClick={() => saveStatus(sheetAction)}>{sheetAction.label}</Button>
          </div>
        )}
      </Sheet>
      <Sheet open={sheet === "urgency"} onClose={() => setSheet(null)} title="Change urgency">
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Use this when the urgency is wrong. The resident sees the change, and Insights tracks how often your team keeps the suggestion.</p>
          <div className="seg urgency" role="group" aria-label="Urgency">
            {(["Emergency", "Urgent", "Routine"] as Urgency[]).map((u) => <button key={u} data-v={u} aria-pressed={urgPick === u} onClick={() => setUrgPick(u)}>{u}</button>)}
          </div>
          <span className="hint">Resident sent: {req.urgency}{req.ai_urgency ? ` · AI suggested: ${req.ai_urgency}` : ""}</span>
          <Button block loading={saving} disabled={urgPick === level} onClick={saveUrgency}>Save urgency</Button>
        </div>
      </Sheet>
      {zoom && photoUrl && (
        <div className="scrim" style={{ alignItems: "center", padding: 16 }} onClick={() => setZoom(false)} role="dialog" aria-modal="true" aria-label="Photo"
          onKeyDown={(e) => { if (e.key === "Escape") setZoom(false); }}>
          <img src={photoUrl} alt="Photo of the problem" style={{ maxHeight: "90vh", borderRadius: 12 }} />
          <button className="icon-btn" autoFocus aria-label="Close photo" onClick={() => setZoom(false)} style={{ position: "fixed", top: 16, right: 16, background: "var(--surface)" }}><Icon name="x" /></button>
        </div>
      )}
    </div>
  );
}
