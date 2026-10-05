import { useCallback, useEffect, useId, useRef, useState } from "react";
import { STATUS_LABEL } from "../../shared/triage.js";
import { supabase, friendly, PHOTO_BUCKET } from "../lib/supabase";
import { useSession } from "../lib/session";
import { notify } from "../lib/api";
import { agoLong, when, telHref } from "../lib/format";
import type { RequestEvent, RequestRow, Status } from "../lib/types";
import { Button, Sheet, Skeleton, StatusBadge, UrgencyBadge, useToast, Empty } from "../ui/kit";
import { Icon } from "../ui/icons";

interface PersonMap { [id: string]: string }

const NEXT: Record<Status, { s: Status; label: string }[]> = {
  new: [{ s: "acknowledged", label: "Mark as seen" }, { s: "scheduled", label: "Schedule" }, { s: "in_progress", label: "Start work" }],
  acknowledged: [{ s: "scheduled", label: "Schedule" }, { s: "in_progress", label: "Start work" }, { s: "resolved", label: "Mark fixed" }],
  scheduled: [{ s: "in_progress", label: "Start work" }, { s: "resolved", label: "Mark fixed" }],
  in_progress: [{ s: "resolved", label: "Mark fixed" }],
  resolved: [{ s: "acknowledged", label: "Reopen" }],
  canceled: [{ s: "acknowledged", label: "Reopen" }],
};

export function RequestDetail({ id, mode }: { id: string; mode: "resident" | "manager" }) {
  const { user, memberships, externalPlaces } = useSession();
  const toast = useToast();
  const [req, setReq] = useState<RequestRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [people, setPeople] = useState<PersonMap>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [statusSheet, setStatusSheet] = useState<{ s: Status; label: string } | null>(null);
  const [note, setNote] = useState("");
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

  const sendMsg = async () => {
    const body = msg.trim(); if (!body) return;
    setSending(true);
    const { data, error } = await supabase.from("request_events").insert({ request_id: req.id, kind: "message", body }).select("id").single();
    setSending(false);
    if (error) return toast(friendly(error), "error");
    setMsg(""); notify(data.id); void load();
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 100);
  };
  const changeStatus = async (s: Status, n: string) => {
    setSaving(true);
    const { error } = await supabase.rpc("set_request_status", { p_request: req.id, p_status: s, p_note: n || null });
    setSaving(false);
    if (error) return toast(friendly(error), "error");
    setStatusSheet(null); setNote("");
    toast(`Marked ${STATUS_LABEL[s].toLowerCase()}`);
    const { data: ev } = await supabase.from("request_events").select("id").eq("request_id", req.id).eq("kind", "status").eq("actor_id", user!.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    notify(ev?.id); void load();
  };

  const actions = mode === "manager" ? NEXT[req.status]
    : isOpen ? [...(["scheduled", "in_progress"].includes(req.status) ? [{ s: "resolved" as Status, label: "It's fixed" }] : []), ...(["new", "acknowledged"].includes(req.status) ? [{ s: "canceled" as Status, label: "Cancel request" }] : [])] : [];

  return (
    <div className="stack-lg">
      <header className="stack-sm">
        <div className="row-wrap"><UrgencyBadge u={req.urgency} /><StatusBadge s={req.status} manager={mode === "manager"} />{req.manual_review && <span className="badge flag">Needs manual review</span>}
          {req.ai_urgency && req.ai_urgency !== req.urgency && <span className="badge warn">Resident changed from {req.ai_urgency}</span>}</div>
        <h1 className="h1" style={{ fontSize: 24 }}>{req.title}</h1>
        <div className="small muted">{mode === "manager" ? `${residentName} · ` : ""}{placeName}{req.unit ? ` · ${req.unit}` : ""} · <span className="mono">{req.ref}</span></div>
      </header>

      {mode === "manager" && req.urgency === "Emergency" && isOpen && (
        <div className="notice warn"><Icon name="alert" /><div><b>Emergency.</b> Reported {agoLong(req.created_at)}. Contact the resident now.</div></div>
      )}

      {actions.length > 0 && (
        <div className="row-wrap">
          {actions.map((a, i) => <Button key={a.s} size="sm" variant={i === 0 ? "primary" : a.s === "canceled" ? "danger-outline" : "secondary"} onClick={() => { setNote(""); setStatusSheet(a); }}>{a.label}</Button>)}
        </div>
      )}

      {photoUrl && <button type="button" onClick={() => setZoom(true)} aria-label="Enlarge photo" style={{ border: 0, padding: 0, background: "none", cursor: "zoom-in" }}><img className="photo-hero" src={photoUrl} alt="Photo of the problem" /></button>}

      <section className="card pad stack">
        <div className="body-text">{req.body}</div>
        {req.answers?.length > 0 && <div className="stack-sm">{req.answers.map((a) => <div key={a.q} className="small"><span className="muted">{a.q}</span><br />{a.a}</div>)}</div>}
        <dl className="facts" style={{ margin: 0 }}>
          <div><dt>Category</dt><dd>{req.category}</dd></div>
          <div><dt>Reported</dt><dd>{when(req.created_at)}</dd></div>
          {req.location_in_home && <div><dt>Where</dt><dd>{req.location_in_home}</dd></div>}
          <div><dt>Entry if not home</dt><dd className="row" style={{ gap: 6 }}>{req.entry_permission === null ? "Not answered" : <><Icon name={req.entry_permission ? "unlock" : "lock"} width={16} height={16} style={{ color: req.entry_permission ? "var(--rout)" : "var(--emer)" }} />{req.entry_permission ? "Allowed" : "Not allowed"}</>}</dd></div>
          {req.has_pets !== null && <div><dt>Pets</dt><dd>{req.has_pets ? "Yes" : "No"}</dd></div>}
          {req.availability && <div><dt>Best times</dt><dd>{req.availability}</dd></div>}
        </dl>
        {req.entry_notes && <div className="small"><span className="muted">Entry notes: </span>{req.entry_notes}</div>}
        {req.ai_reason && <div className="small muted" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}><Icon name="sparkle" width={14} height={14} style={{ verticalAlign: -2 }} /> AI check{req.ai_urgency ? ` (${req.ai_urgency})` : ""}: {req.ai_reason}</div>}
      </section>

      {mode === "resident" && ext && (
        <section className="card pad stack-sm">
          <h2 className="h3">Sent outside FixCheck</h2>
          <p className="small muted" style={{ margin: 0 }}>Your landlord doesn't use FixCheck, so updates won't appear here. Contact them directly:</p>
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
              return (
                <li key={e.id}>
                  <span className={`node ${e.kind !== "message" ? "st" : ""}`}><Icon name={e.kind === "message" ? "message" : e.kind === "created" ? "send" : "check"} /></span>
                  <div className="grow">
                    <div className="small"><b>{who}</b> <span className="muted">{e.kind === "created" ? "sent the request" : e.kind === "status" ? `marked it ${STATUS_LABEL[e.status as Status]?.toLowerCase()}` : ""} · {agoLong(e.created_at)}</span></div>
                    {e.body && <div className={`bubble ${e.actor_id === user?.id ? "mine" : ""}`}>{e.body}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
          <div ref={endRef} />
          <div className="composer">
            <label htmlFor={msgId} className="sr-only" style={{ position: "absolute", left: -9999 }}>Message</label>
            <textarea id={msgId} className="textarea" rows={1} placeholder={mode === "manager" ? `Message ${residentName}…` : "Message maintenance…"} value={msg} onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendMsg(); }} />
            <Button icon="send" loading={sending} disabled={!msg.trim()} onClick={sendMsg} aria-label="Send message" />
          </div>
        </section>
      )}

      <Sheet open={!!statusSheet} onClose={() => setStatusSheet(null)} title={statusSheet?.label}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>{statusSheet?.s === "canceled" ? "Maintenance will see that you canceled it." : `The ${mode === "manager" ? "resident" : "manager"} gets an update.`}</p>
          <div className="field"><label className="label" htmlFor="status-note">Note <span className="opt">(optional)</span></label>
            <textarea id="status-note" className="textarea" placeholder={statusSheet?.s === "scheduled" ? "Plumber Tuesday 9–11 AM" : "Add details"} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <Button block loading={saving} variant={statusSheet?.s === "canceled" ? "danger" : "primary"} onClick={() => statusSheet && changeStatus(statusSheet.s, note.trim())}>{statusSheet?.label}</Button>
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
