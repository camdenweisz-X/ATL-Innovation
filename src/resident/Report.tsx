import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CATEGORIES, RANK, SAFETY_QS, type Triage } from "../../shared/triage.js";
import { supabase, friendly, PHOTO_BUCKET } from "../lib/supabase";
import { useSession } from "../lib/session";
import { local } from "../lib/store";
import { runTriage, notify, ApiError } from "../lib/api";
import { downscale, blobToDataURL, dataURLToBlob } from "../lib/image";
import { isAfterHours, telHref, when } from "../lib/format";
import type { Place, Urgency } from "../lib/types";
import { Button, Empty, Field, YesNo, useToast } from "../ui/kit";
import { Icon, type IconName } from "../ui/icons";
import { TopBar } from "../AppShell";

const GAS_LINE = "1-877-427-4321"; // Atlanta Gas Light emergency line
const ROOMS = ["Kitchen", "Bathroom", "Bedroom", "Living room", "Laundry", "Hallway", "Outside", "Other"];
const TIMES = ["Weekday mornings", "Weekday afternoons", "Evenings", "Weekends", "Anytime"];
const ICON: Record<Urgency, IconName> = { Emergency: "alert", Urgent: "clock", Routine: "calendarCheck" };
const WHEN: Record<Urgency, string> = {
  Emergency: "Call your after-hours maintenance line now.",
  Urgent: "Send it tonight. It can wait until morning, so you can go to bed.",
  Routine: "Send it whenever. It will be scheduled during business hours.",
};

type View = "compose" | "checking" | "review" | "done";
interface Draft { placeKey?: string; desc: string; checklist: Record<string, string>; room: string; thumb: string | null; big: string | null; at: number; }
interface Review {
  ai: Triage | null; aiError: string | null; localTime: string; afterHours: boolean;
  urgency: Urgency; category: string; title: string; body: string; answers: string[];
  entry: boolean | null; entryNotes: string; pets: boolean | null; times: string[];
}
const DRAFT_KEY = "fc_draft", REVIEW_KEY = "fc_review", MAX_AGE = 6 * 3600e3;
const blankDraft = (): Draft => ({ desc: "", checklist: {}, room: "", thumb: null, big: null, at: Date.now() });

export function Report() {
  const { places, user, profile } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const saved = local.get<Draft | null>(DRAFT_KEY, null);
  const fresh = saved && Date.now() - saved.at < MAX_AGE ? saved : null;
  const [draft, setDraft] = useState<Draft>(fresh || blankDraft());
  const savedReview = fresh ? local.get<Review | null>(REVIEW_KEY, null) : null;
  const [review, setReview] = useState<Review | null>(savedReview);
  const [view, setView] = useState<View>(savedReview ? "review" : "compose");
  const [placeKey, setPlaceKey] = useState<string>(draft.placeKey || local.get("fc_last_place", "") || places[0]?.key || "");
  const place = places.find((p) => p.key === placeKey) || places[0];
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [resumeNote, setResumeNote] = useState(false);
  const [stage, setStage] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ id: string; ref: string; place: Place; text: string; subject: string } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const descId = useId();

  // Restore the full-size photo saved with the draft.
  useEffect(() => { if (draft.big && !photo) dataURLToBlob(draft.big).then(setPhoto).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view !== "done") local.set(DRAFT_KEY, { ...draft, placeKey, at: Date.now() }) || local.set(DRAFT_KEY, { ...draft, big: null, placeKey, at: Date.now() }); }, [draft, placeKey, view]);
  useEffect(() => { if (review && view === "review") local.set(REVIEW_KEY, review); }, [review, view]);

  if (!places.length) {
    return (
      <>
        <TopBar title="Report a problem" />
        <div className="page">
          <Empty icon="home" title="Connect your home first" action={<Link className="btn" to="/settings/places">Add a home</Link>}>
            Add your property code, or your landlord's email or phone, so FixCheck knows where to send requests.
          </Empty>
        </div>
      </>
    );
  }

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    try {
      const big = await downscale(f, 1280, 0.82);
      const small = await downscale(f, 320, 0.6);
      setPhoto(big);
      setDraft((d) => ({ ...d, thumb: null, big: null }));
      const [t, b] = await Promise.all([blobToDataURL(small), blobToDataURL(big)]);
      setDraft((d) => ({ ...d, thumb: t, big: b }));
    } catch { setErr("That photo couldn't be read. Try a JPG or PNG, or take a new one with the camera."); }
  };

  const floorYes = SAFETY_QS.filter((s) => draft.checklist[s.k] === "yes");

  const check = async (skipAI = false) => {
    const description = draft.desc.trim();
    if (!skipAI) {
      if (!description && !photo) return setErr("Add a photo or a few words about the problem first.");
      if (!description) return setErr("Add a few words too, like what you noticed and when it started.");
    }
    setErr(null); setResumeNote(false);
    const now = new Date();
    const base = { localTime: when(now.toISOString()), afterHours: isAfterHours(now) };
    const fallbackLevel: Urgency = floorYes.length ? "Emergency" : "Urgent";
    const blank: Review = { ai: null, aiError: skipAI ? "skipped" : null, ...base, urgency: fallbackLevel, category: "Other",
      title: description.split(/[.!?\n]/)[0].slice(0, 60) || "Maintenance request",
      body: description ? `${description}\n\nIt started [when it started].` : "", answers: [], entry: null, entryNotes: "", pets: null, times: [] };
    if (skipAI) { setReview(blank); setView("review"); return; }
    setView("checking"); setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, 2)), 4000);
    ctl.current = new AbortController();
    try {
      const ai = await runTriage({ description, checklist: draft.checklist, localTime: base.localTime, afterHours: base.afterHours, locationInHome: draft.room, photo },
        { signal: ctl.current.signal, onResume: () => setResumeNote(true) });
      const level = floorYes.length ? "Emergency" : ai.urgency;
      setReview({ ...blank, ai, aiError: null, urgency: level, category: ai.category, title: ai.title, body: ai.request, answers: ai.questions.map(() => "") });
    } catch (e) {
      setReview({ ...blank, aiError: e instanceof ApiError ? e.code : "unavailable" });
    } finally { clearInterval(t); setView("review"); window.scrollTo(0, 0); }
  };

  const startOver = () => {
    local.del(DRAFT_KEY); local.del(REVIEW_KEY);
    setDraft(blankDraft()); setReview(null); setPhoto(null); setDone(null); setView("compose"); window.scrollTo(0, 0);
  };

  const submit = async () => {
    if (!review || !place || !user) return;
    const body = review.body.trim();
    if (!body) return setErr("The message to maintenance is empty. Add a sentence about the problem.");
    setErr(null); setSubmitting(true);
    try {
      let photo_path: string | null = null;
      if (photo) {
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, photo, { contentType: "image/jpeg", upsert: false });
        if (up.error) throw up.error;
        photo_path = path;
      }
      const ai = review.ai;
      const answers = (ai?.questions || []).map((q, i) => ({ q, a: (review.answers[i] || "").trim() })).filter((x) => x.a);
      const row = {
        property_id: place.kind === "property" ? place.property.id : null,
        external_place_id: place.kind === "external" ? place.place.id : null,
        unit: place.unit, title: review.title.trim() || "Maintenance request", category: review.category, urgency: review.urgency,
        ai_urgency: ai?.urgency ?? null, ai_reason: ai?.reason ?? null, safety_flags: floorYes.map((s) => s.k),
        description: draft.desc.trim() || null, body, answers, location_in_home: draft.room || null,
        entry_permission: review.entry, entry_notes: review.entry ? review.entryNotes.trim() || null : null,
        has_pets: review.pets, availability: review.times.join(", ") || null, photo_path, manual_review: !ai,
      };
      const { data, error } = await supabase.from("requests").insert(row).select("id, ref").single();
      if (error) throw error;
      if (place.kind === "property") {
        const { data: ev } = await supabase.from("request_events").select("id").eq("request_id", data.id).eq("kind", "created").maybeSingle();
        notify(ev?.id);
      }
      local.set("fc_last_place", place.key);
      const subject = `[${review.urgency}] ${row.title}${place.unit ? ` · ${place.unit}` : ""}`;
      const lines = [subject, `${profile?.full_name || ""}${place.unit ? ` · ${place.unit}` : ""} · ${place.label}`, `Reported ${review.localTime} · ${review.category} · ${data.ref}`, "", body];
      if (draft.room) lines.push("", `Where: ${draft.room}`);
      if (answers.length) { lines.push("", "Details:"); answers.forEach((a) => lines.push(`- ${a.q} ${a.a}`)); }
      if (review.entry !== null) lines.push(`Permission to enter: ${review.entry ? "Yes" : "No"}${review.entry && review.entryNotes ? ` (${review.entryNotes})` : ""}`);
      if (review.pets !== null) lines.push(`Pets in the home: ${review.pets ? "Yes" : "No"}`);
      if (review.times.length) lines.push(`Best times: ${review.times.join(", ")}`);
      lines.push("", ai ? `AI urgency check: ${ai.urgency}. ${ai.reason}${review.urgency !== ai.urgency ? ` I changed it to ${review.urgency}.` : ""}` : "Sent without the AI urgency check.");
      setDone({ id: data.id, ref: data.ref, place, text: lines.join("\n"), subject });
      local.del(DRAFT_KEY); local.del(REVIEW_KEY);
      setView("done"); window.scrollTo(0, 0);
    } catch (e) {
      toast(friendly(e), "error"); setErr(friendly(e));
    } finally { setSubmitting(false); }
  };

  const stepNo = view === "compose" || view === "checking" ? 1 : view === "review" ? 2 : 3;
  const afterHoursLine = place?.kind === "property" ? place.property.after_hours_phone : place?.place.after_hours_phone;

  return (
    <>
      <TopBar title="Report a problem" right={view !== "compose" && view !== "done" ? <button className="btn ghost sm" onClick={startOver}>Start over</button> : undefined} />
      <div className="page">
        <ol className="steps" aria-label={`Step ${stepNo} of 3`}>
          {["Describe", "Review", "Send"].map((s, i) => <li key={s} className={i + 1 < stepNo ? "done" : i + 1 === stepNo ? "on" : ""}>{s}</li>)}
        </ol>

        {view === "compose" && (
          <div className="stack-lg">
            <div>
              <h1 className="h1">What's wrong?</h1>
              <p className="lede">Add a photo and a few words. You'll get an urgency call and a drafted request to check before anything is sent.</p>
            </div>
            {places.length > 1 && (
              <Field label="Which home?" htmlFor="home-select">
                <select id="home-select" className="select" value={place?.key} onChange={(e) => setPlaceKey(e.target.value)}>
                  {places.map((p) => <option key={p.key} value={p.key}>{p.label}{p.unit ? ` · ${p.unit}` : ""}</option>)}
                </select>
              </Field>
            )}
            {places.length === 1 && place && (
              <div className="row small muted"><Icon name="pin" width={16} height={16} />{place.label}{place.unit ? ` · ${place.unit}` : ""}</div>
            )}
            <label className={`photo-pick ${draft.thumb ? "has" : ""}`}>
              {draft.thumb ? <img className="thumb" src={draft.thumb} alt="Your photo of the problem" /> : <span className="thumb"><Icon name="camera" /></span>}
              <span className="grow"><span className="h3" style={{ display: "block" }}>{draft.thumb ? "Photo added" : "Add a photo"}</span>
                <span className="small muted">{draft.thumb ? "Tap to change it." : "Take one now or choose from your photos."}</span></span>
              <input type="file" accept="image/*" aria-label="Add a photo" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            {draft.thumb && <button className="btn ghost sm" style={{ alignSelf: "flex-start", marginTop: -8 }} onClick={() => { setPhoto(null); setDraft((d) => ({ ...d, thumb: null, big: null })); }}><Icon name="trash" />Remove photo</button>}
            <Field label="What's going on?" htmlFor={descId}>
              <textarea id={descId} className="textarea" placeholder="Water dripping from the bathroom ceiling over the sink, started tonight" value={draft.desc} onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, desc: v })); }} />
            </Field>
            <Field label="Where in your home?" optional>
              <div className="row-wrap">{ROOMS.map((r) => <button key={r} type="button" className="chip" aria-pressed={draft.room === r} onClick={() => setDraft((d) => ({ ...d, room: d.room === r ? "" : r }))}>{r}</button>)}</div>
            </Field>
            <div className="field">
              <span className="label" id="safetyLbl">Is any of this happening right now?</span>
              <div className="card checks" role="group" aria-labelledby="safetyLbl">
                {SAFETY_QS.map((s) => (
                  <div className="check-row" key={s.k}>
                    <span className="small" style={{ fontSize: 15 }}>{s.q}</span>
                    <YesNo value={draft.checklist[s.k] === "yes" ? true : draft.checklist[s.k] === "no" ? false : null}
                      onChange={(v) => setDraft((d) => ({ ...d, checklist: { ...d.checklist, [s.k]: v === null ? "" : v ? "yes" : "no" } }))} />
                  </div>
                ))}
              </div>
              <span className="hint">Any "Yes" marks it as an emergency, even if the AI disagrees.</span>
            </div>
            {floorYes.length > 0 && <EmergencyPanel line={afterHoursLine} gas={floorYes.some((s) => s.k === "gas" || s.k === "co")} fire={floorYes.some((s) => s.k === "fire")} />}
            {err && <p className="err" role="alert"><Icon name="alert" width={16} height={16} />{err}</p>}
            <div className="actionbar">
              <Button block onClick={() => check(false)} icon="sparkle">Check urgency</Button>
              <button className="btn ghost sm" onClick={() => check(true)}>Skip the AI and fill it in myself</button>
            </div>
          </div>
        )}

        {view === "checking" && (
          <div className="stack-lg">
            <div><h1 className="h1">Checking urgency</h1>
              <p className="lede">{resumeNote ? "Picking up where you left off…" : "Usually 10 to 30 seconds. You can switch apps; FixCheck picks up when you come back."}</p></div>
            <div className="card pad stack">
              <div className="row">{draft.thumb && <img src={draft.thumb} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }} />}<div className="small muted grow">{draft.desc.slice(0, 120)}</div></div>
              <ol className="stages">
                {["Reading your photo and description", "Applying the urgency rules", "Drafting your request"].map((t, i) => (
                  <li key={t} className={i < stage ? "done" : i === stage ? "on" : ""}><span className="dotc">{i < stage && <Icon name="check" />}</span>{t}</li>
                ))}
              </ol>
            </div>
            <div className="actionbar"><button className="btn ghost sm" onClick={() => ctl.current?.abort()}>Stop and fill it in myself</button></div>
          </div>
        )}

        {view === "review" && review && (
          <ReviewStep review={review} setReview={setReview} floorYes={floorYes.map((s) => s.q)} place={place!} afterHoursLine={afterHoursLine}
            onRetry={() => check(false)} onSubmit={submit} submitting={submitting} err={err} />
        )}

        {view === "done" && done && <DoneStep done={done} urgency={review?.urgency || "Routine"} afterHoursLine={afterHoursLine} onNew={startOver} onView={() => nav(`/r/requests/${done.id}`)} />}
      </div>
    </>
  );
}

function EmergencyPanel({ line, gas, fire, message }: { line?: string | null; gas: boolean; fire: boolean; message?: string }) {
  return (
    <div className="alarm" role="alert">
      <div className="h3">{message || "This needs help right now."}</div>
      <ol>
        {gas && <li>Leave now. Don't flip switches, light anything, or start a car. From outside, call 911 or Atlanta Gas Light at <a className="tel" href={telHref(GAS_LINE)}>{GAS_LINE}</a>.</li>}
        {fire && !gas && <li>If there's fire or heavy smoke, get out and call <a className="tel" href="tel:911">911</a>.</li>}
        <li>{line ? <>Call your after-hours maintenance line: <a className="tel" href={telHref(line)}>{line}</a>.</> : "Call your property's after-hours maintenance line."}</li>
        <li>Then send this report so there's a written record with your photo.</li>
      </ol>
    </div>
  );
}

const ERR_COPY: Record<string, string> = {
  skipped: "You're filling this in yourself.", cancelled: "You stopped the AI check.", busy: "The AI check is busy right now.",
  auth: "Your session expired. Sign in again to use the AI check.", unavailable: "The AI check couldn't be reached.",
};

function ReviewStep({ review, setReview, floorYes, place, afterHoursLine, onRetry, onSubmit, submitting, err }: {
  review: Review; setReview: (r: Review) => void; floorYes: string[]; place: Place; afterHoursLine?: string | null;
  onRetry: () => void; onSubmit: () => void; submitting: boolean; err: string | null;
}) {
  const ai = review.ai;
  const set = (patch: Partial<Review>) => setReview({ ...review, ...patch });
  const blanks = useMemo(() => review.body.match(/\[[^\]\n]{1,80}\]/g) || [], [review.body]);
  const [confirmBlanks, setConfirmBlanks] = useState(false);
  const ids = { t: useId(), b: useId(), c: useId(), n: useId() };
  const lowered = ai && RANK[review.urgency] < RANK[ai.urgency];
  const sendLabel = place.kind === "property" ? `Send to ${place.label}` : "Continue to send";
  return (
    <div className="stack-lg">
      {review.urgency === "Emergency" && <EmergencyPanel line={afterHoursLine} message={ai?.safety_message || undefined}
        gas={/gas|carbon monoxide/i.test(`${ai?.category} ${floorYes.join(" ")}`)} fire={/fire|smoke/i.test(`${ai?.category} ${floorYes.join(" ")}`)} />}
      <div className={`verdict ${review.urgency}`}>
        <span className="eyebrow">{ai ? "AI urgency check" : "Your urgency call"}</span>
        <div className="lvl"><Icon name={ICON[review.urgency]} />{review.urgency}</div>
        <div className="when">{WHEN[review.urgency]}</div>
        {ai && <div className="small muted">{ai.reason}{floorYes.length > 0 && ai.urgency !== "Emergency" ? ` The AI said ${ai.urgency}; your safety answers make it an emergency.` : ""}</div>}
        {ai?.photo_notes && ai.photo_notes !== "No photo" && <div className="xs muted">Photo: {ai.photo_notes}</div>}
      </div>
      {!ai && (
        <div className="notice warn"><Icon name="info" /><div className="stack-sm" style={{ gap: 6 }}>
          <div><b>{ERR_COPY[review.aiError || "unavailable"] || ERR_COPY.unavailable}</b> You can still send this. Your manager will see it marked for manual review.</div>
          {review.aiError !== "skipped" && review.aiError !== "cancelled" && <button className="btn secondary sm" style={{ alignSelf: "flex-start" }} onClick={onRetry}><Icon name="refresh" />Try the AI check again</button>}
        </div></div>
      )}
      {ai && ai.until_fixed.length > 0 && (
        <section className="card pad stack-sm">
          <h2 className="h3">Until it's fixed</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }} className="stack-sm">{ai.until_fixed.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      )}
      <section className="card pad stack">
        <h2 className="h2">Your request</h2>
        <div className="field">
          <span className="label" id="urgLbl">Urgency</span>
          <div className="seg urgency" role="group" aria-labelledby="urgLbl">
            {(["Emergency", "Urgent", "Routine"] as Urgency[]).map((u) => <button key={u} data-v={u} aria-pressed={review.urgency === u} onClick={() => set({ urgency: u })}>{u}</button>)}
          </div>
          <span className="hint">{ai ? (review.urgency !== ai.urgency ? `You changed this from ${ai.urgency}. Your manager will see both.` : "Suggested by the AI. Change it if it's wrong.") : "Pick the level that fits."}
            {lowered && floorYes.length > 0 ? " You answered yes to a safety question, so double-check this." : ""}</span>
        </div>
        <Field label="Category" htmlFor={ids.c}><select id={ids.c} className="select" value={review.category} onChange={(e) => set({ category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Title" htmlFor={ids.t}><input id={ids.t} className="input" value={review.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Message to maintenance" htmlFor={ids.b}>
          <textarea id={ids.b} className="textarea" style={{ minHeight: 180 }} value={review.body} onChange={(e) => { set({ body: e.target.value }); setConfirmBlanks(false); }} />
          {blanks.length > 0 && <span className="hint" style={{ color: "var(--urg)", fontWeight: 600 }}>Fill in or delete {blanks.length === 1 ? "the blank" : `${blanks.length} blanks`} in [brackets], like {blanks[0]}.</span>}
        </Field>
        {ai && ai.questions.length > 0 && (
          <div className="stack-sm">
            <span className="label">Maintenance will likely ask</span>
            {ai.questions.map((q, i) => (
              <div key={q} className="field"><label className="small" htmlFor={`qa-${i}`} style={{ fontWeight: 550 }}>{q}</label>
                <input id={`qa-${i}`} className="input" placeholder="Your answer (optional)" value={review.answers[i] || ""} onChange={(e) => { const a = review.answers.slice(); a[i] = e.target.value; set({ answers: a }); }} /></div>
            ))}
          </div>
        )}
      </section>
      <section className="card pad stack">
        <div><h2 className="h2">Access</h2><p className="hint" style={{ margin: "4px 0 0" }}>Helps maintenance plan the visit. All optional.</p></div>
        <div className="between"><span id="entryLbl" style={{ fontWeight: 550 }}>Can maintenance enter if you're not home?</span><YesNo neutral labelledBy="entryLbl" value={review.entry} onChange={(v) => set({ entry: v })} /></div>
        {review.entry && <Field label="Entry notes" optional htmlFor={ids.n}><input id={ids.n} className="input" placeholder="Alarm code, dog in crate, knock first…" value={review.entryNotes} onChange={(e) => set({ entryNotes: e.target.value })} /></Field>}
        <div className="between"><span id="petLbl" style={{ fontWeight: 550 }}>Any pets in the home?</span><YesNo neutral labelledBy="petLbl" value={review.pets} onChange={(v) => set({ pets: v })} /></div>
        <div className="field"><span className="label">Best times for a visit</span>
          <div className="row-wrap">{TIMES.map((t) => <button key={t} type="button" className="chip" aria-pressed={review.times.includes(t)} onClick={() => set({ times: review.times.includes(t) ? review.times.filter((x) => x !== t) : [...review.times, t] })}>{t}</button>)}</div></div>
      </section>
      {err && <p className="err" role="alert"><Icon name="alert" width={16} height={16} />{err}</p>}
      <div className="actionbar">
        <Button block loading={submitting} icon="send" onClick={() => {
          if (blanks.length && !confirmBlanks) { setConfirmBlanks(true); return; }
          onSubmit();
        }}>{blanks.length && confirmBlanks ? "Send anyway" : sendLabel}</Button>
        {blanks.length > 0 && confirmBlanks && <span className="hint center">Your message still has blanks in [brackets]. Tap again to send anyway.</span>}
      </div>
    </div>
  );
}

function DoneStep({ done, urgency, afterHoursLine, onNew, onView }: {
  done: { id: string; ref: string; place: Place; text: string; subject: string }; urgency: Urgency; afterHoursLine?: string | null; onNew: () => void; onView: () => void;
}) {
  const p = done.place;
  const ext = p.kind === "external" ? p.place : null;
  const [shared, setShared] = useState(false);
  const canShare = typeof navigator.share === "function";
  const next = urgency === "Emergency" ? { t: "Call now", d: afterHoursLine ? <>After-hours line: <a className="tel mono" href={telHref(afterHoursLine)}>{afterHoursLine}</a>. The written request doesn't replace the call.</> : "Call your after-hours maintenance line. The written request doesn't replace the call." }
    : urgency === "Urgent" ? { t: "You can go to bed", d: "Maintenance should pick this up first thing in the morning." } : { t: "All set", d: "This gets scheduled during business hours." };
  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <span className="avatar" style={{ width: 52, height: 52, background: "var(--rout-bg)", color: "var(--rout)" }}><Icon name="check" width={26} height={26} /></span>
        <h1 className="h1">{ext ? "Your request is ready to send" : `Sent to ${p.label}`}</h1>
        <p className="lede">{ext ? `Choose how to send it to ${ext.contact_name || "your landlord"}. Your email or texting app opens with everything filled in; tap send there.` : "Your manager has it now. You'll see updates and messages on the request."}</p>
      </div>
      <div className={`verdict ${urgency}`}><div className="lvl" style={{ fontSize: 22 }}>{next.t}</div><div className="small">{next.d}</div></div>
      {ext && (
        <div className="stack-sm">
          {canShare && <Button block icon="share" onClick={async () => {
            try { await navigator.share({ title: done.subject, text: done.text }); setShared(true); } catch { /* closed */ }
          }}>{shared ? "Opened. Send it there" : "Send with another app…"}</Button>}
          {ext.contact_email && <a className="btn secondary block" href={`mailto:${ext.contact_email.replace(/[^\w.+@-]/g, "")}?subject=${encodeURIComponent(done.subject)}&body=${encodeURIComponent(done.text)}`}><Icon name="mail" />Email {ext.contact_name || "landlord"}</a>}
          {ext.contact_phone && <a className="btn secondary block" href={`sms:${ext.contact_phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(done.text)}`}><Icon name="phone" />Text {ext.contact_name || "landlord"}</a>}
          <span className="hint">Email and text can't attach the photo automatically. Add it from your camera roll in the message.</span>
        </div>
      )}
      <div className="card pad stack-sm"><div className="between"><span className="mono muted">{done.ref}</span><span className="xs muted">Saved to your requests</span></div>
        <div className="body-text small" style={{ maxHeight: 220, overflow: "auto" }}>{done.text}</div></div>
      <div className="actionbar">
        <Button block variant="secondary" onClick={onView}>View request</Button>
        <Button block onClick={onNew} icon="plus">Report something else</Button>
      </div>
    </div>
  );
}
