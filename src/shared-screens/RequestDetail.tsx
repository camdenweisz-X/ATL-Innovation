import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { STATUS_LABEL, URGENCY_REASONS } from "../../shared/triage.js";
import { finalUrgency } from "../../shared/workorders.js";
import { workOrderText } from "../../shared/exports.js";
import { supabase, friendly, PHOTO_BUCKET, VIDEO_BUCKET } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useT } from "../lib/i18n";
import { notify, translateTexts } from "../lib/api";
import { agoLong, when, telHref, visitTime, ordinal, toLocalInput } from "../lib/format";
import type { RequestEvent, RequestRow, Status, Urgency, UrgencyReason } from "../lib/types";
import { Button, CopyButton, Field, LangBadge, Sheet, Skeleton, StatusBadge, UrgencyBadge, useToast, Empty, YesNo } from "../ui/kit";
import { Icon, type IconName } from "../ui/icons";

interface Person { name: string; phone: string | null }
export interface RepeatInfo { nth?: number; count?: number; days?: number; building?: number }
type Action = { s: Status; label: string };

const NEXT: Record<Status, Action[]> = /* i18n */{
  new: [{ s: "acknowledged", label: "Mark as seen" }, { s: "scheduled", label: "Schedule visit" }, { s: "resolved", label: "Mark fixed" }],
  acknowledged: [{ s: "scheduled", label: "Schedule visit" }, { s: "in_progress", label: "Start work" }, { s: "resolved", label: "Mark fixed" }],
  scheduled: [{ s: "resolved", label: "Mark fixed" }, { s: "in_progress", label: "Start work" }, { s: "scheduled", label: "Reschedule" }],
  in_progress: [{ s: "resolved", label: "Mark fixed" }, { s: "scheduled", label: "Schedule return visit" }],
  resolved: [{ s: "acknowledged", label: "Reopen" }],
  canceled: [{ s: "acknowledged", label: "Reopen" }],
};

type T = (s: string, v?: Record<string, string | number | null | undefined>) => string;
export function eventText(e: RequestEvent, t: T): { text: string; icon: IconName } {
  if (e.kind === "created") return { text: t("sent the request"), icon: "send" };
  if (e.kind === "urgency") {
    const why = URGENCY_REASONS.find((r) => r.k === e.detail?.reason);
    return { text: `${t("changed the urgency to {level}", { level: t(e.detail?.urgency ?? "") })}${why ? ` (${t(why.label).toLowerCase()})` : ""}`, icon: "alert" };
  }
  if (e.kind === "escalated") {
    return { text: e.detail?.backup_reached
      ? t("No one acknowledged within {n} minutes. CanItWait alerted the backup contact and reminded the team.", { n: e.detail?.after_min ?? 10 })
      : t("No one acknowledged within {n} minutes. CanItWait reminded the team.", { n: e.detail?.after_min ?? 10 }), icon: "bell" };
  }
  if (e.kind === "message") return { text: "", icon: "message" };
  if (e.status === "scheduled") return { text: e.detail?.scheduled_for ? (e.detail.tech ? t("scheduled a visit for {time} with {tech}", { time: visitTime(e.detail.scheduled_for), tech: e.detail.tech }) : t("scheduled a visit for {time}", { time: visitTime(e.detail.scheduled_for) })) : t("scheduled a visit"), icon: "calendar" };
  if (e.status === "resolved") return { text: e.detail?.first_visit === false ? t("marked it fixed (took more than one visit)") : e.detail?.first_visit ? t("marked it fixed on the first visit") : t("marked it fixed"), icon: "check" };
  return { text: t("marked it {status}", { status: t(STATUS_LABEL[e.status as Status] || "updated").toLowerCase() }), icon: "check" };
}

export function RequestDetail({ id, mode, repeat }: { id: string; mode: "resident" | "manager"; repeat?: RepeatInfo }) {
  const { user, memberships, externalPlaces, managed } = useSession();
  const { t, tn, tx, lang } = useT();
  const toast = useToast();
  const [req, setReq] = useState<RequestRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState<Action | "urgency" | null>(null);
  const [note, setNote] = useState("");
  const [visit, setVisit] = useState("");
  const [tech, setTech] = useState("");
  const [firstVisit, setFirstVisit] = useState<boolean | null>(null);
  const [urgPick, setUrgPick] = useState<Urgency>("Urgent");
  const [reason, setReason] = useState<UrgencyReason | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [tr, setTr] = useState<Record<string, string>>({});
  const [showTr, setShowTr] = useState(false);
  const [translating, setTranslating] = useState(false);
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
    const { data: ps } = await supabase.from("profiles").select("id, full_name, phone").in("id", ids);
    setPeople(Object.fromEntries((ps || []).map((p) => [p.id, { name: p.full_name || t("Someone"), phone: p.phone }])));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setReq(null); setMissing(false); setPhotoUrl(null); setVideoUrl(null); setTr({}); setShowTr(false); void load(); }, [load]);
  useEffect(() => {
    if (!req?.photo_path) return;
    supabase.storage.from(PHOTO_BUCKET).createSignedUrl(req.photo_path, 3600).then(({ data }) => setPhotoUrl(data?.signedUrl || null));
  }, [req?.photo_path]);
  useEffect(() => {
    if (!req?.video_path) return;
    supabase.storage.from(VIDEO_BUCKET).createSignedUrl(req.video_path, 3600).then(({ data }) => setVideoUrl(data?.signedUrl || null));
  }, [req?.video_path]);
  useEffect(() => {
    const ch = supabase.channel(`req-${id}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "request_events", filter: `request_id=eq.${id}` }, () => void load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "requests", filter: `id=eq.${id}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [id, load]);

  if (missing) return <div className="page"><Empty icon="info" title={t("Request not found")}>{t("It may have been deleted, or you no longer have access to it.")}</Empty></div>;
  if (!req) return <div className="card pad"><Skeleton h={28} n={6} /></div>;

  const membership = memberships.find((m) => m.property_id === req.property_id);
  const managedProp = managed.find((p) => p.id === req.property_id);
  const ext = externalPlaces.find((e) => e.id === req.external_place_id);
  const placeName = membership?.property?.name || managedProp?.name || ext?.label || t("Your home");
  const afterHoursLine = membership?.property?.after_hours_phone || ext?.after_hours_phone || null;
  const isOpen = !["resolved", "canceled"].includes(req.status);
  const canMessage = !!req.property_id;
  const resident = people[req.resident_id];
  const residentName = resident?.name || t("Resident");
  const level = finalUrgency(req);
  const lastEvent = (kind: string) => [...events].reverse().find((e) => e.kind === kind);
  const emergencyUnseen = level === "Emergency" && req.status === "new" && isOpen;

  // Translation: the request itself when it was written in another language, and messages from other people.
  const otherMsgs = events.filter((e) => e.kind === "message" && e.actor_id !== user?.id && e.body);
  const reqTexts = req.lang !== lang ? [req.title, req.body, req.entry_notes, req.access_notes, req.ai_reason, ...(req.answers || []).flatMap((a) => [a.q, a.a])].filter((x): x is string => !!x) : [];
  const toTranslate = Array.from(new Set([...reqTexts, ...otherMsgs.map((e) => e.body as string)])).filter((s) => !(s in tr));
  const canTranslate = reqTexts.length > 0 || otherMsgs.length > 0;
  const T = (s: string | null | undefined) => (s && showTr && tr[s]) || s || "";
  const translate = async () => {
    if (showTr) return setShowTr(false);
    if (!toTranslate.length) return setShowTr(true);
    setTranslating(true);
    try {
      const out = await translateTexts(toTranslate.slice(0, 30), lang);
      setTr((m) => ({ ...m, ...Object.fromEntries(toTranslate.slice(0, 30).map((s, i) => [s, out[i]])) }));
      setShowTr(true);
    } catch { toast(t("Translation isn't available right now. Try again in a minute."), "error"); }
    finally { setTranslating(false); }
  };
  const trLabel = translating ? t("Translating…") : showTr ? t("Show original") : t("Translate to {language}", { language: t(lang === "es" ? "Spanish" : "English") });

  const openSheet = (a: Action | "urgency") => {
    setNote(""); setFirstVisit(null); setReason(null);
    if (a !== "urgency" && a.s === "scheduled") {
      const d = req.scheduled_for ? new Date(req.scheduled_for) : (() => { const x = new Date(); x.setDate(x.getDate() + 1); x.setHours(9, 0, 0, 0); return x; })();
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

  const saveStatus = async (a: Action, quick = false) => {
    if (a.s === "scheduled" && !visit) return toast(t("Pick a visit date and time."), "error");
    setSaving(true);
    const { error } = await supabase.rpc("set_request_status", {
      p_request: req.id, p_status: a.s, p_note: quick ? null : note.trim() || null,
      p_scheduled_for: a.s === "scheduled" ? new Date(visit).toISOString() : null,
      p_tech: a.s === "scheduled" ? tech.trim() || null : null,
      p_first_visit: a.s === "resolved" ? firstVisit : null,
    });
    setSaving(false);
    if (error) return toast(friendly(error), "error");
    setSheet(null);
    toast(a.s === "scheduled" ? t("Visit scheduled") : t("Marked {status}", { status: t(STATUS_LABEL[a.s]).toLowerCase() }));
    const { data: ev } = await supabase.from("request_events").select("id").eq("request_id", req.id).eq("kind", "status").eq("actor_id", user!.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    notify(ev?.id); void load();
  };
  const saveUrgency = async () => {
    if (!reason) return toast(t("Pick a reason so your team can see why it changed."), "error");
    setSaving(true);
    const { error } = await supabase.rpc("set_request_urgency", { p_request: req.id, p_urgency: urgPick, p_reason: reason, p_note: note.trim() || null });
    setSaving(false);
    if (error) return toast(friendly(error), "error");
    setSheet(null); toast(t("Urgency set to {level}", { level: t(urgPick) })); void load();
  };

  const actions: Action[] = mode === "manager" ? NEXT[req.status].map((a) => ({ ...a, label: emergencyUnseen && a.s === "acknowledged" ? /* i18n */["Acknowledge emergency"][0] : a.label }))
    : !isOpen ? []
    : ext ? /* i18n */[{ s: "resolved", label: "It's fixed" }, { s: "canceled", label: "Cancel request" }]
    : [...(["scheduled", "in_progress"].includes(req.status) ? [{ s: "resolved" as Status, label: "It's fixed" }] : []),
       ...(["new", "acknowledged"].includes(req.status) ? [{ s: "canceled" as Status, label: "Cancel request" }] : [])];
  const sheetAction = sheet && sheet !== "urgency" ? sheet : null;
  const urgEvent = lastEvent("urgency");
  const yesNo = (v: boolean | null) => (v === null ? t("Not answered") : v ? t("Yes") : t("No"));
  const workOrder = mode === "manager" ? workOrderText(req, { property: placeName, resident: residentName, phone: resident?.phone, link: `${window.location.origin}/m/requests/${req.id}`, when: when(req.created_at) }, t) : "";

  return (
    <div className="stack-lg">
      <header className="stack-sm">
        <div className="row-wrap">
          <UrgencyBadge u={level} /><StatusBadge s={req.status} manager={mode === "manager"} />
          {req.lang !== lang && <LangBadge lang={req.lang} />}
          {req.manual_review && <span className="badge flag">{t("Needs manual review")}</span>}
          {req.mgr_urgency && <span className="badge flag">{mode === "manager" ? t("Urgency changed by your team") : t("Urgency updated by maintenance")}</span>}
          {mode === "manager" && !req.mgr_urgency && req.ai_urgency && req.ai_urgency !== req.urgency && <span className="badge warn">{t("Resident changed from {level}", { level: t(req.ai_urgency) })}</span>}
          {mode === "manager" && repeat?.count && <span className="badge warn"><Icon name="refresh" />{t("Repeat · {nth} of {count} in {days}", { nth: ordinal(repeat.nth || 1), count: repeat.count, days: tn(repeat.days || 1, "{n} day", "{n} days") })}</span>}
          {mode === "manager" && repeat?.building && <span className="badge warn"><Icon name="building" />{t("{n} units, same problem", { n: repeat.building })}</span>}
        </div>
        <h1 className="h1" style={{ fontSize: 24 }}>{T(req.title)}</h1>
        <div className="small muted">{mode === "manager" ? `${residentName} · ` : ""}{placeName}{req.unit ? ` · ${req.unit}` : ""} · <span className="mono">{req.ref}</span></div>
      </header>

      {mode === "manager" && level === "Emergency" && isOpen && (
        <div className={`notice ${emergencyUnseen ? "emer" : "warn"}`}><Icon name="alert" /><div className="stack-sm" style={{ gap: 8 }}>
          <div><b>{t("Emergency.")}</b> {t("Reported {ago}. Contact the resident now.", { ago: agoLong(req.created_at) })}{req.escalated_at ? ` ${t("Escalated to the backup contact.")}` : ""}</div>
          <div className="row-wrap">
            {emergencyUnseen && <Button size="sm" variant="danger" loading={saving} onClick={() => saveStatus({ s: "acknowledged", label: "" }, true)}>{t("Acknowledge")}</Button>}
            {resident?.phone && <a className="btn secondary sm" href={telHref(resident.phone)}><Icon name="phone" />{t("Call {name}", { name: residentName })}</a>}
          </div>
        </div></div>
      )}

      {mode === "resident" && emergencyUnseen && (
        <div className="alarm" role="alert">
          <div className="h3">{req.escalated_at ? t("Your manager hasn't seen this yet. CanItWait alerted their backup contact.") : t("Waiting for your manager to see this emergency.")}</div>
          <div>{t("Don't wait on the app. If anyone is in danger, call 911. Otherwise call the after-hours line.")}</div>
          <div className="call-btns">
            <a className="call-btn" href="tel:911"><Icon name="phone" />{t("Call 911")}</a>
            {afterHoursLine && <a className="call-btn" href={telHref(afterHoursLine)}><Icon name="phone" /><span>{t("After-hours line")}<small>{afterHoursLine}</small></span></a>}
          </div>
        </div>
      )}

      {req.status === "scheduled" && req.scheduled_for && (
        <div className="notice info"><Icon name="calendarCheck" /><div><b>{t("Visit {time}", { time: visitTime(req.scheduled_for) })}</b>{req.tech ? ` · ${req.tech}` : ""}
          {mode === "resident" && lastEvent("status")?.body && <div className="small" style={{ marginTop: 4 }}>“{T(lastEvent("status")?.body)}”</div>}</div></div>
      )}

      {actions.length > 0 && (
        <div className="row-wrap">
          {actions.map((a, i) => <Button key={a.label} size="sm" variant={a.s === "canceled" ? "danger-outline" : i === 0 ? "primary" : "secondary"} onClick={() => openSheet(a)}>{t(a.label)}</Button>)}
          {mode === "manager" && isOpen && <Button size="sm" variant="ghost" icon="alert" onClick={() => openSheet("urgency")}>{t("Change urgency")}</Button>}
        </div>
      )}

      {photoUrl && <button type="button" onClick={() => setZoom(true)} aria-label={t("Enlarge photo")} style={{ border: 0, padding: 0, background: "none", cursor: "zoom-in" }}><img className="photo-hero" src={photoUrl} alt={t("Photo of the problem")} /></button>}
      {videoUrl && <video className="photo-hero" src={videoUrl} controls playsInline preload="metadata" aria-label={t("Video of the problem")} />}

      <section className="card pad stack">
        {canTranslate && reqTexts.length > 0 && (
          <div className="between" style={{ marginBottom: -4 }}>
            <span className="xs muted">{showTr ? t("Translated by AI from {language}", { language: t(req.lang === "es" ? "Spanish" : "English") }) : t("Written in {language}", { language: t(req.lang === "es" ? "Spanish" : "English") })}</span>
            <button className="btn ghost sm" onClick={translate} disabled={translating}><Icon name="translate" />{trLabel}</button>
          </div>
        )}
        <div className="body-text">{T(req.body)}</div>
        {req.answers?.length > 0 && <div className="stack-sm">{req.answers.map((a) => <div key={a.q} className="small"><span className="muted">{T(a.q)}</span><br />{T(a.a)}</div>)}</div>}
        <dl className="facts" style={{ margin: 0 }}>
          <div><dt>{t("Category")}</dt><dd>{t(req.category)}</dd></div>
          <div><dt>{t("Reported")}</dt><dd>{when(req.created_at)}{req.after_hours ? ` · ${t("after hours")}` : ""}</dd></div>
          {req.location_in_home && <div><dt>{t("Where")}</dt><dd>{t(req.location_in_home)}</dd></div>}
          <div><dt>{t("Entry if not home")}</dt><dd className="row" style={{ gap: 6 }}>{req.entry_permission === null ? t("Not answered") : <><Icon name={req.entry_permission ? "unlock" : "lock"} width={16} height={16} style={{ color: req.entry_permission ? "var(--rout)" : "var(--emer)" }} />{req.entry_permission ? t("Allowed") : t("Not allowed")}</>}</dd></div>
          {req.has_pets !== null && <div><dt>{t("Pets")}</dt><dd>{yesNo(req.has_pets)}</dd></div>}
          {req.availability && <div><dt>{t("Best times")}</dt><dd>{req.availability.split(", ").map((x) => t(x)).join(", ")}</dd></div>}
          {req.status === "resolved" && req.first_visit !== null && <div><dt>{t("Visits")}</dt><dd>{req.first_visit ? t("Fixed on the first visit") : t("Took more than one visit")}</dd></div>}
        </dl>
        {req.entry_notes && <div className="small"><span className="muted">{t("Entry notes")}: </span>{T(req.entry_notes)}</div>}
        {req.access_notes && <div className="small"><span className="muted">{t("Access notes")}: </span>{T(req.access_notes)}</div>}
        {req.ai_reason && <div className="small muted" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}><Icon name="sparkle" width={14} height={14} style={{ verticalAlign: -2 }} /> {t("AI check")}{req.ai_urgency ? ` (${t(req.ai_urgency)})` : ""}: {T(req.ai_reason)}</div>}
        {req.mgr_urgency && urgEvent && <div className="small muted">{t("Urgency changed from {from} to {to} {ago}.", { from: t(req.urgency), to: t(req.mgr_urgency), ago: agoLong(urgEvent.created_at) })}</div>}
      </section>

      <div className="row-wrap">
        {mode === "manager" && <CopyButton text={workOrder} label={t("Copy as work order")} />}
        <Link to={`/record/${req.id}`} className="btn secondary sm"><Icon name="printer" />{mode === "manager" ? t("Print record") : t("Save a record (PDF)")}</Link>
      </div>

      {mode === "resident" && ext && (
        <section className="card pad stack-sm">
          <h2 className="h3">{t("Sent outside CanItWait")}</h2>
          <p className="small muted" style={{ margin: 0 }}>{t("Your landlord doesn't use CanItWait, so updates won't appear here. Contact them directly, and mark it fixed here when it's done.")}</p>
          <div className="row-wrap">{ext.contact_email && <a className="btn secondary sm" href={`mailto:${ext.contact_email}`}><Icon name="mail" />{t("Email")}</a>}
            {ext.contact_phone && <a className="btn secondary sm" href={telHref(ext.contact_phone)}><Icon name="phone" />{t("Call")}</a>}</div>
        </section>
      )}

      {canMessage && (
        <section className="stack">
          <div className="between">
            <h2 className="h2">{t("Activity")}</h2>
            {otherMsgs.length > 0 && reqTexts.length === 0 && <button className="btn ghost sm" onClick={translate} disabled={translating}><Icon name="translate" />{trLabel}</button>}
          </div>
          <ol className="timeline">
            {events.map((e) => {
              const who = e.kind === "escalated" ? "CanItWait" : e.actor_id === user?.id ? t("You") : people[e.actor_id || ""]?.name || (mode === "resident" ? t("Maintenance") : t("Someone"));
              const tx2 = eventText(e, t);
              const bodyText = e.kind === "urgency" ? e.detail?.note : e.kind === "escalated" ? null : e.body;
              return (
                <li key={e.id}>
                  <span className={`node ${e.kind !== "message" ? "st" : ""} ${e.kind === "escalated" ? "esc" : ""}`}><Icon name={tx2.icon} /></span>
                  <div className="grow">
                    <div className="small"><b>{who}</b> <span className="muted">{tx2.text}{tx2.text ? " · " : ""}{agoLong(e.created_at)}</span></div>
                    {bodyText && <div className={`bubble ${e.actor_id === user?.id ? "mine" : ""}`}>{e.actor_id === user?.id ? bodyText : T(bodyText)}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
          <div ref={endRef} />
          <div className="composer">
            <label htmlFor={msgId} style={{ position: "absolute", left: -9999 }}>{t("Message")}</label>
            <textarea id={msgId} className="textarea" rows={1} placeholder={mode === "manager" ? t("Message {name}…", { name: residentName }) : t("Message maintenance…")} value={msg} onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendMsg(); }} />
            <Button icon="send" loading={sending} disabled={!msg.trim()} onClick={sendMsg} aria-label={t("Send message")} />
          </div>
          {mode === "manager" && req.lang !== lang && <p className="hint" style={{ margin: 0 }}>{tx("{name} uses CanItWait in {language}. They can translate your messages with one tap.", { name: <b>{residentName}</b>, language: t(req.lang === "es" ? "Spanish" : "English") })}</p>}
        </section>
      )}

      <Sheet open={!!sheetAction} onClose={() => setSheet(null)} title={sheetAction ? t(sheetAction.label) : undefined}>
        {sheetAction && (
          <div className="stack">
            {sheetAction.s === "scheduled" && (<>
              <Field label={t("Visit date and time")} htmlFor="wo-when"><input id="wo-when" className="input" type="datetime-local" value={visit} onChange={(e) => setVisit(e.target.value)} /></Field>
              <Field label={t("Technician")} optional htmlFor="wo-tech"><input id="wo-tech" className="input" placeholder="Marcus" value={tech} onChange={(e) => setTech(e.target.value)} /></Field>
            </>)}
            {sheetAction.s === "resolved" && mode === "manager" && (
              <div className="between"><span id="fv-lbl" style={{ fontWeight: 600 }}>{t("Fixed on the first visit?")}</span><YesNo neutral labelledBy="fv-lbl" value={firstVisit} onChange={setFirstVisit} /></div>
            )}
            {sheetAction.s === "resolved" && mode === "manager" && <p className="hint" style={{ margin: "-8px 0 0" }}>{t("Feeds the first-visit fix rate in Insights.")}</p>}
            <p className="muted" style={{ margin: 0 }}>{sheetAction.s === "canceled" ? t("Maintenance will see that you canceled it.") : ext && mode === "resident" ? t("This only updates your own list.") : mode === "manager" ? t("The resident gets an update.") : t("The manager gets an update.")}</p>
            <div className="field"><label className="label" htmlFor="status-note">{sheetAction.s === "scheduled" ? t("Note to the resident") : t("Note")} <span className="opt">({t("optional")})</span></label>
              <textarea id="status-note" className="textarea" placeholder={sheetAction.s === "scheduled" ? t("We'll check the unit above yours too.") : t("Add details")} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button block loading={saving} variant={sheetAction.s === "canceled" ? "danger" : "primary"} onClick={() => saveStatus(sheetAction)}>{t(sheetAction.label)}</Button>
          </div>
        )}
      </Sheet>
      <Sheet open={sheet === "urgency"} onClose={() => setSheet(null)} title={t("Change urgency")}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>{t("Use this when the urgency is wrong. The resident sees the change, and Insights tracks how often the AI's call holds up.")}</p>
          <div className="seg urgency" role="group" aria-label={t("Urgency")}>
            {(["Emergency", "Urgent", "Routine"] as Urgency[]).map((u) => <button key={u} data-v={u} aria-pressed={urgPick === u} onClick={() => setUrgPick(u)}>{t(u)}</button>)}
          </div>
          <span className="hint">{t("Resident sent: {level}", { level: t(req.urgency) })}{req.ai_urgency ? ` · ${t("AI suggested: {level}", { level: t(req.ai_urgency) })}` : ""}</span>
          <div className="field"><span className="label" id="why-lbl">{t("Why?")}</span>
            <div className="row-wrap" role="group" aria-labelledby="why-lbl">{URGENCY_REASONS.map((r) => <button key={r.k} type="button" className="chip" aria-pressed={reason === r.k} onClick={() => setReason(r.k)}>{t(r.label)}</button>)}</div></div>
          <Field label={t("Note")} optional htmlFor="urg-note"><input id="urg-note" className="input" maxLength={300} placeholder={t("Spoke with the resident; water is contained.")} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button block loading={saving} disabled={urgPick === level || !reason} onClick={saveUrgency}>{t("Save urgency")}</Button>
        </div>
      </Sheet>
      {zoom && photoUrl && (
        <div className="scrim" style={{ alignItems: "center", padding: 16 }} onClick={() => setZoom(false)} role="dialog" aria-modal="true" aria-label={t("Photo")}
          onKeyDown={(e) => { if (e.key === "Escape") setZoom(false); }}>
          <img src={photoUrl} alt={t("Photo of the problem")} style={{ maxHeight: "90vh", borderRadius: 12 }} />
          <button className="icon-btn" autoFocus aria-label={t("Close photo")} onClick={() => setZoom(false)} style={{ position: "fixed", top: 16, right: 16, background: "var(--surface)" }}><Icon name="x" /></button>
        </div>
      )}
    </div>
  );
}
