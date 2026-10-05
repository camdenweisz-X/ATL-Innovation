import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CATEGORIES, RANK, SAFETY_QS, safetyHints, type Triage } from "../../shared/triage.js";
import { supabase, friendly, PHOTO_BUCKET, VIDEO_BUCKET } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useT } from "../lib/i18n";
import { local } from "../lib/store";
import { runTriage, notify, ApiError } from "../lib/api";
import { downscale, blobToDataURL, dataURLToBlob, videoStill } from "../lib/image";
import { isAfterHours, telHref, when } from "../lib/format";
import type { Place, Urgency } from "../lib/types";
import { Button, Empty, Field, Sheet, YesNo, useToast } from "../ui/kit";
import { Icon, type IconName } from "../ui/icons";
import { TopBar } from "../AppShell";
import { PhotoPicker, VideoPicker } from "./PhotoPicker";

const GAS_LINE = "1-877-427-4321"; // Atlanta Gas Light emergency line
const ROOMS = /* i18n */["Kitchen", "Bathroom", "Bedroom", "Living room", "Laundry", "Hallway", "Outside", "Other"];
const TIMES = /* i18n */["Weekday mornings", "Weekday afternoons", "Evenings", "Weekends", "Anytime"];
const ICON: Record<Urgency, IconName> = { Emergency: "alert", Urgent: "clock", Routine: "calendarCheck" };
const WHEN: Record<Urgency, string> = /* i18n */{
  Emergency: "Call your after-hours maintenance line now.",
  Urgent: "Send it tonight. It can wait until morning, so you can go to bed.",
  Routine: "Send it whenever. It will be scheduled during business hours.",
};
/** What each safety-question key sounds like in a sentence ("You mentioned …"). */
const HINT_WORDS: Record<string, string> = /* i18n */{
  gas: "a gas smell", fire: "smoke, sparks or burning", water: "water or sewage you can't stop", co: "a carbon monoxide alarm", lock: "a door that won't lock",
};
const MAX_VIDEO_MB = 50, MAX_VIDEO_S = 60;
const BLANK_RE = /\[[^\]\n]{1,80}\]/g;

type View = "compose" | "checking" | "review" | "done";
interface Draft { placeKey?: string; desc: string; checklist: Record<string, string>; room: string; thumb: string | null; big: string | null; at: number; }
interface Access { entry: boolean | null; entryNotes: string; pets: boolean | null; times: string[]; accessNotes: string }
interface Review extends Access {
  ai: Triage | null; aiError: string | null; localTime: string; afterHours: boolean;
  urgency: Urgency; category: string; title: string; body: string; answers: string[];
}
export interface Video { file: File; duration: number; thumb: string }
const DRAFT_KEY = "fc_draft", REVIEW_KEY = "fc_review", ACCESS_KEY = "cw_access", MAX_AGE = 6 * 3600e3;
const blankDraft = (): Draft => ({ desc: "", checklist: {}, room: "", thumb: null, big: null, at: Date.now() });
const noAccess: Access = { entry: null, entryNotes: "", pets: null, times: [], accessNotes: "" };
/** Access answers are remembered per home on this device (cleared at sign-out), so residents don't retype gate codes. */
const savedAccess = (key: string): Access => ({ ...noAccess, ...(local.get<Record<string, Access>>(ACCESS_KEY, {})[key] || {}) });
const blankLabel = (b: string) => { const s = b.slice(1, -1).trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

export function Report() {
  const { places, user, profile } = useSession();
  const { t, lang } = useT();
  const toast = useToast();
  const nav = useNavigate();
  const saved = local.get<Draft | null>(DRAFT_KEY, null);
  const fresh = saved && Date.now() - saved.at < MAX_AGE ? saved : null;
  const [draft, setDraft] = useState<Draft>(fresh || blankDraft());
  const savedReview = fresh ? local.get<Review | null>(REVIEW_KEY, null) : null;
  const [review, setReview] = useState<Review | null>(savedReview ? { ...noAccess, ...savedReview } : null);
  const [view, setView] = useState<View>(savedReview ? "review" : "compose");
  const [placeKey, setPlaceKey] = useState<string>(draft.placeKey || local.get("fc_last_place", "") || places[0]?.key || "");
  const place = places.find((p) => p.key === placeKey) || places[0];
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resumeNote, setResumeNote] = useState(false);
  const [stage, setStage] = useState(0);
  const [submitting, setSubmitting] = useState<false | "photo" | "video" | "saving">(false);
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
        <TopBar title={t("Report a problem")} />
        <div className="page">
          <Empty icon="home" title={t("Connect your home first")} action={<Link className="btn" to="/settings/places">{t("Add a home")}</Link>}>
            {t("Add your property code, or your landlord's email or phone, so CanItWait knows where to send requests.")}
          </Empty>
        </div>
      </>
    );
  }

  const setPhotoFrom = async (f: Blob) => {
    const big = await downscale(f, 1280, 0.82);
    const small = await downscale(f, 320, 0.6);
    setPhoto(big);
    setDraft((d) => ({ ...d, thumb: null, big: null }));
    const [tb, b] = await Promise.all([blobToDataURL(small), blobToDataURL(big)]);
    setDraft((d) => ({ ...d, thumb: tb, big: b }));
  };
  const pick = async (f: Blob | undefined) => {
    if (!f) return;
    setErr(null);
    if (f.type.startsWith("video/")) return pickVideo(f as File);
    try { await setPhotoFrom(f); }
    catch { setErr(t("That photo couldn't be read. Try a JPG or PNG, or take a new one with the camera.")); }
  };
  const pickVideo = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    if (f.size > MAX_VIDEO_MB * 1024 * 1024) return setErr(t("That video is too large. Keep it under {mb} MB (about 30 seconds).", { mb: MAX_VIDEO_MB }));
    setVideoBusy(true);
    try {
      const { duration, frame } = await videoStill(f);
      if (duration > MAX_VIDEO_S + 1) { setVideoBusy(false); return setErr(t("Keep videos to {s} seconds or less.", { s: MAX_VIDEO_S })); }
      const thumb = await blobToDataURL(await downscale(frame, 320, 0.6));
      setVideo({ file: f, duration, thumb });
      if (!photo) await setPhotoFrom(frame); // the AI looks at a still from the video when there's no photo
    } catch {
      setErr(t("That video couldn't be read. Try recording it again with the camera."));
    } finally { setVideoBusy(false); }
  };

  const floorYes = SAFETY_QS.filter((s) => draft.checklist[s.k] === "yes");
  const hints = safetyHints(draft.desc).filter((k) => draft.checklist[k] !== "no");

  const check = async (skipAI = false) => {
    const description = draft.desc.trim();
    if (!skipAI) {
      if (!description && !photo) return setErr(t("Add a photo or a few words about the problem first."));
      if (!description) return setErr(t("Add a few words too, like what you noticed and when it started."));
    }
    setErr(null); setResumeNote(false);
    const now = new Date();
    const base = { localTime: when(now.toISOString()), afterHours: isAfterHours(now) };
    const fallbackLevel: Urgency = floorYes.length ? "Emergency" : "Urgent";
    const blank: Review = { ai: null, aiError: skipAI ? "skipped" : null, ...base, urgency: fallbackLevel, category: "Other",
      title: description.split(/[.!?\n]/)[0].slice(0, 60) || t("Maintenance request"),
      body: description ? `${description}\n\n${t("It started [when it started].")}` : "", answers: [], ...savedAccess(place!.key) };
    if (skipAI) { setReview(blank); setView("review"); return; }
    setView("checking"); setStage(0);
    const tm = setInterval(() => setStage((s) => Math.min(s + 1, 2)), 4000);
    ctl.current = new AbortController();
    try {
      const ai = await runTriage({ description, checklist: draft.checklist, localTime: base.localTime, afterHours: base.afterHours, locationInHome: draft.room, photo, lang },
        { signal: ctl.current.signal, onResume: () => setResumeNote(true) });
      const level = floorYes.length ? "Emergency" : ai.urgency;
      setReview({ ...blank, ai, aiError: null, urgency: level, category: ai.category, title: ai.title, body: ai.request, answers: ai.questions.map(() => "") });
    } catch (e) {
      setReview({ ...blank, aiError: e instanceof ApiError ? e.code : "unavailable" });
    } finally { clearInterval(tm); setView("review"); window.scrollTo(0, 0); }
  };

  const startOver = () => {
    local.del(DRAFT_KEY); local.del(REVIEW_KEY);
    setDraft(blankDraft()); setReview(null); setPhoto(null); setVideo(null); setDone(null); setView("compose"); window.scrollTo(0, 0);
  };

  const submit = async (bodyOverride?: string) => {
    if (!review || !place || !user) return;
    const body = (bodyOverride ?? review.body).trim();
    if (!body) return setErr(t("The message to maintenance is empty. Add a sentence about the problem."));
    setErr(null);
    try {
      let photo_path: string | null = null, video_path: string | null = null;
      if (photo) {
        setSubmitting("photo");
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, photo, { contentType: "image/jpeg", upsert: false });
        if (up.error) throw up.error;
        photo_path = path;
      }
      if (video) {
        setSubmitting("video");
        const ext = video.file.type === "video/quicktime" ? "mov" : video.file.type === "video/webm" ? "webm" : "mp4";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from(VIDEO_BUCKET).upload(path, video.file, { contentType: video.file.type || "video/mp4", upsert: false });
        if (up.error) throw up.error;
        video_path = path;
      }
      setSubmitting("saving");
      const ai = review.ai;
      const answers = (ai?.questions || []).map((q, i) => ({ q, a: (review.answers[i] || "").trim() })).filter((x) => x.a);
      const row = {
        property_id: place.kind === "property" ? place.property.id : null,
        external_place_id: place.kind === "external" ? place.place.id : null,
        unit: place.unit, title: review.title.trim() || t("Maintenance request"), category: review.category, urgency: review.urgency,
        ai_urgency: ai?.urgency ?? null, ai_reason: ai?.reason ?? null, safety_flags: floorYes.map((s) => s.k),
        description: draft.desc.trim() || null, body, answers, location_in_home: draft.room || null,
        entry_permission: review.entry, entry_notes: review.entry ? review.entryNotes.trim() || null : null,
        has_pets: review.pets, availability: review.times.join(", ") || null, access_notes: review.accessNotes.trim() || null,
        photo_path, video_path, manual_review: !ai, lang,
        after_hours: review.afterHours, blanks_left: Math.min(50, (body.match(BLANK_RE) || []).length),
      };
      const { data, error } = await supabase.from("requests").insert(row).select("id, ref").single();
      if (error) throw error;
      if (place.kind === "property") {
        const { data: ev } = await supabase.from("request_events").select("id").eq("request_id", data.id).eq("kind", "created").maybeSingle();
        notify(ev?.id);
      }
      local.set("fc_last_place", place.key);
      const acc = local.get<Record<string, Access>>(ACCESS_KEY, {});
      acc[place.key] = { entry: review.entry, entryNotes: review.entryNotes, pets: review.pets, times: review.times, accessNotes: review.accessNotes };
      local.set(ACCESS_KEY, acc);
      const yes = (v: boolean) => t(v ? "Yes" : "No");
      const subject = `[${t(review.urgency)}] ${row.title}${place.unit ? ` · ${place.unit}` : ""}`;
      const lines = [subject, `${profile?.full_name || ""}${place.unit ? ` · ${place.unit}` : ""} · ${place.label}`, `${t("Reported {time}", { time: review.localTime })} · ${t(review.category)} · ${data.ref}`, "", body];
      if (draft.room) lines.push("", `${t("Where")}: ${t(draft.room)}`);
      if (answers.length) { lines.push("", `${t("Details")}:`); answers.forEach((a) => lines.push(`- ${a.q} ${a.a}`)); }
      if (review.entry !== null) lines.push(`${t("Permission to enter")}: ${yes(review.entry)}${review.entry && review.entryNotes ? ` (${review.entryNotes})` : ""}`);
      if (review.pets !== null) lines.push(`${t("Pets in the home")}: ${yes(review.pets)}`);
      if (review.accessNotes.trim()) lines.push(`${t("Access notes")}: ${review.accessNotes.trim()}`);
      if (review.times.length) lines.push(`${t("Best times")}: ${review.times.map((x) => t(x)).join(", ")}`);
      lines.push("", ai ? `${t("AI urgency check")}: ${t(ai.urgency)}. ${ai.reason}${review.urgency !== ai.urgency ? ` ${t("I changed it to {level}.", { level: t(review.urgency) })}` : ""}` : t("Sent without the AI urgency check."));
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
      <TopBar title={t("Report a problem")} right={view !== "compose" && view !== "done" ? <button className="btn ghost sm" onClick={startOver}>{t("Start over")}</button> : undefined} />
      <div className="page">
        <ol className="steps" aria-label={t("Step {n} of 3", { n: stepNo })}>
          {/* i18n */["Describe", "Review", "Send"].map((s, i) => <li key={s} className={i + 1 < stepNo ? "done" : i + 1 === stepNo ? "on" : ""}>{t(s)}</li>)}
        </ol>

        {view === "compose" && (
          <div className="stack-lg">
            <div>
              <h1 className="h1">{t("What's wrong?")}</h1>
              <p className="lede">{t("Add a photo or short video and a few words. You'll get an urgency call and a drafted request to check before anything is sent.")}</p>
            </div>
            {places.length > 1 && (
              <Field label={t("Which home?")} htmlFor="home-select">
                <select id="home-select" className="select" value={place?.key} onChange={(e) => setPlaceKey(e.target.value)}>
                  {places.map((p) => <option key={p.key} value={p.key}>{p.label}{p.unit ? ` · ${p.unit}` : ""}</option>)}
                </select>
              </Field>
            )}
            {places.length === 1 && place && (
              <div className="row small muted"><Icon name="pin" width={16} height={16} />{place.label}{place.unit ? ` · ${place.unit}` : ""}</div>
            )}
            <PhotoPicker thumb={draft.thumb} onPick={pick} onRemove={() => { setPhoto(null); setDraft((d) => ({ ...d, thumb: null, big: null })); }} />
            <VideoPicker video={video} busy={videoBusy} maxSeconds={MAX_VIDEO_S} onPick={pickVideo} onRemove={() => setVideo(null)} />
            {video && !draft.thumb && <p className="hint" style={{ marginTop: -8 }}>{t("The AI looks at a still from your video. Your manager gets the whole video.")}</p>}
            <Field label={t("What's going on?")} htmlFor={descId}>
              <textarea id={descId} className="textarea" placeholder={t("Water dripping from the bathroom ceiling over the sink, started tonight")} value={draft.desc} onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, desc: v })); }} />
            </Field>
            <Field label={t("Where in your home?")} optional>
              <div className="row-wrap">{ROOMS.map((r) => <button key={r} type="button" className="chip" aria-pressed={draft.room === r} onClick={() => setDraft((d) => ({ ...d, room: d.room === r ? "" : r }))}>{t(r)}</button>)}</div>
            </Field>
            <div className="field">
              <span className="label" id="safetyLbl">{t("Is any of this happening right now?")}</span>
              <div className="card checks" role="group" aria-labelledby="safetyLbl">
                {SAFETY_QS.map((s) => {
                  const flagged = hints.includes(s.k) && !draft.checklist[s.k];
                  return (
                    <div className={`check-row ${flagged ? "flagged" : ""}`} key={s.k}>
                      <span className="small" style={{ fontSize: 15 }}>{t(s.q)}{flagged && <span className="flag-note">{t("You mentioned this. Please answer.")}</span>}</span>
                      <YesNo value={draft.checklist[s.k] === "yes" ? true : draft.checklist[s.k] === "no" ? false : null}
                        onChange={(v) => setDraft((d) => ({ ...d, checklist: { ...d.checklist, [s.k]: v === null ? "" : v ? "yes" : "no" } }))} />
                    </div>
                  );
                })}
              </div>
              <span className="hint">{t("Any \"Yes\" marks it as an emergency, even if the AI disagrees.")}</span>
            </div>
            {floorYes.length > 0 && <EmergencyPanel line={afterHoursLine} gas={floorYes.some((s) => s.k === "gas" || s.k === "co")} fire={floorYes.some((s) => s.k === "fire")} />}
            {err && <p className="err" role="alert"><Icon name="alert" width={16} height={16} />{err}</p>}
            <div className="actionbar">
              <Button block onClick={() => check(false)} icon="sparkle" disabled={videoBusy}>{t("Check urgency")}</Button>
              <button className="btn ghost sm" onClick={() => check(true)}>{t("Skip the AI and fill it in myself")}</button>
            </div>
          </div>
        )}

        {view === "checking" && (
          <div className="stack-lg">
            <div><h1 className="h1">{t("Checking urgency")}</h1>
              <p className="lede">{resumeNote ? t("Picking up where you left off…") : t("Usually 10 to 30 seconds. You can switch apps; CanItWait picks up when you come back.")}</p></div>
            <div className="card pad stack">
              <div className="row">{draft.thumb && <img src={draft.thumb} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }} />}<div className="small muted grow">{draft.desc.slice(0, 120)}</div></div>
              <ol className="stages">
                {/* i18n */["Reading your photo and description", "Applying the urgency rules", "Drafting your request"].map((s, i) => (
                  <li key={s} className={i < stage ? "done" : i === stage ? "on" : ""}><span className="dotc">{i < stage && <Icon name="check" />}</span>{t(s)}</li>
                ))}
              </ol>
            </div>
            <div className="actionbar"><button className="btn ghost sm" onClick={() => ctl.current?.abort()}>{t("Stop and fill it in myself")}</button></div>
          </div>
        )}

        {view === "review" && review && (
          <ReviewStep review={review} setReview={setReview} floorYes={floorYes.map((s) => s.q)} hints={hints} place={place!} afterHoursLine={afterHoursLine}
            onRetry={() => check(false)} onSubmit={submit} submitting={submitting} err={err} hasVideo={!!video} />
        )}

        {view === "done" && done && <DoneStep done={done} urgency={review?.urgency || "Routine"} afterHoursLine={afterHoursLine} onNew={startOver} onView={() => nav(`/r/requests/${done.id}`)} />}
      </div>
    </>
  );
}

/** What to do right now in an emergency, with one-tap call buttons. */
export function EmergencyPanel({ line, gas, fire, message }: { line?: string | null; gas: boolean; fire: boolean; message?: string }) {
  const { t } = useT();
  return (
    <div className="alarm" role="alert">
      <div className="h3">{message || t("This needs help right now.")}</div>
      <ol>
        {gas && <li>{t("Leave now. Don't flip switches, light anything, or start a car. Call from outside.")}</li>}
        {fire && !gas && <li>{t("If there's fire or heavy smoke, get out first, then call 911.")}</li>}
        <li>{line ? t("Call your after-hours maintenance line.") : t("Call your property's after-hours maintenance line.")}</li>
        <li>{t("Then send this report so there's a written record with your photo.")}</li>
      </ol>
      <div className="call-btns">
        {(gas || fire) && <a className="call-btn" href="tel:911"><Icon name="phone" />{t("Call 911")}</a>}
        {gas && <a className="call-btn" href={telHref(GAS_LINE)}><Icon name="phone" /><span>{t("Atlanta Gas Light")}<small>{GAS_LINE}</small></span></a>}
        {line && <a className="call-btn" href={telHref(line)}><Icon name="phone" /><span>{t("After-hours line")}<small>{line}</small></span></a>}
        {!gas && !fire && <a className="call-btn quiet" href="tel:911"><Icon name="phone" />{t("Call 911")}</a>}
      </div>
    </div>
  );
}

function ReviewStep({ review, setReview, floorYes, hints, place, afterHoursLine, onRetry, onSubmit, submitting, err, hasVideo }: {
  review: Review; setReview: (r: Review) => void; floorYes: string[]; hints: string[]; place: Place; afterHoursLine?: string | null;
  onRetry: () => void; onSubmit: (body?: string) => void; submitting: false | "photo" | "video" | "saving"; err: string | null; hasVideo: boolean;
}) {
  const { t } = useT();
  const ai = review.ai;
  const set = (patch: Partial<Review>) => setReview({ ...review, ...patch });
  const blanks = useMemo(() => Array.from(new Set(review.body.match(BLANK_RE) || [])), [review.body]);
  const [fillOpen, setFillOpen] = useState(false);
  const [fills, setFills] = useState<Record<string, string>>({});
  const ids = { t: useId(), b: useId(), c: useId(), n: useId(), a: useId() };
  const lowered = ai && RANK[review.urgency] < RANK[ai.urgency];
  const sendLabel = place.kind === "property" ? t("Send to {place}", { place: place.label }) : t("Continue to send");
  const missedHints = review.urgency !== "Emergency" ? hints : [];
  const errCopy: Record<string, string> = {
    skipped: t("You're filling this in yourself."), cancelled: t("You stopped the AI check."), busy: t("The AI check is busy right now."),
    auth: t("Your sign-in needs refreshing. Sign out and back in to use the AI check."), unavailable: t("The AI check couldn't be reached."),
    config: t("The AI check isn't set up on the server yet."),
  };
  const fillAndSend = () => {
    let body = review.body;
    for (const b of blanks) { const v = (fills[b] || "").trim(); if (v) body = body.split(b).join(v); }
    set({ body });
    setFillOpen(false);
    onSubmit(body);
  };
  const busyLabel = submitting === "photo" ? t("Uploading photo…") : submitting === "video" ? t("Uploading video…") : submitting ? t("Sending…") : null;
  return (
    <div className="stack-lg">
      {review.urgency === "Emergency" && <EmergencyPanel line={afterHoursLine} message={ai?.safety_message || undefined}
        gas={/gas|carbon monoxide/i.test(`${ai?.category} ${floorYes.join(" ")}`)} fire={/fire|smoke/i.test(`${ai?.category} ${floorYes.join(" ")}`)} />}
      <div className={`verdict ${review.urgency}`}>
        <span className="eyebrow">{ai ? t("AI urgency check") : t("Your urgency call")}</span>
        <div className="lvl"><Icon name={ICON[review.urgency]} />{t(review.urgency)}</div>
        <div className="when">{t(WHEN[review.urgency])}</div>
        {ai && <div className="small muted">{ai.reason}{floorYes.length > 0 && ai.urgency !== "Emergency" ? ` ${t("The AI said {level}; your safety answers make it an emergency.", { level: t(ai.urgency) })}` : ""}</div>}
        {ai?.photo_notes && !/^(no photo|sin foto)$/i.test(ai.photo_notes) && <div className="xs muted">{t("Photo")}: {ai.photo_notes}</div>}
        {ai && <div className="xs muted disclaimer"><Icon name="info" width={13} height={13} />{t("This is an AI suggestion, not an inspection. If something feels dangerous, treat it as an emergency.")}</div>}
      </div>
      {missedHints.length > 0 && (
        <div className="notice warn" role="alert"><Icon name="alert" /><div className="stack-sm" style={{ gap: 8 }}>
          <div>{t("You mentioned {things}. If that's happening right now, this is an emergency.", { things: missedHints.map((k) => t(HINT_WORDS[k])).join(", ") })}</div>
          <button className="btn danger sm wrap" style={{ alignSelf: "flex-start" }} onClick={() => set({ urgency: "Emergency" })}>{t("It's happening now: make it an emergency")}</button>
        </div></div>
      )}
      {!ai && (
        <div className="notice warn"><Icon name="info" /><div className="stack-sm" style={{ gap: 6 }}>
          <div><b>{errCopy[review.aiError || "unavailable"] || errCopy.unavailable}</b> {t("You can still send this. Your manager will see it marked for manual review.")}</div>
          {review.aiError !== "skipped" && review.aiError !== "cancelled" && <button className="btn secondary sm" style={{ alignSelf: "flex-start" }} onClick={onRetry}><Icon name="refresh" />{t("Try the AI check again")}</button>}
        </div></div>
      )}
      {ai && ai.until_fixed.length > 0 && (
        <section className="card pad stack-sm">
          <h2 className="h3">{t("Until it's fixed")}</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }} className="stack-sm">{ai.until_fixed.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      )}
      <section className="card pad stack">
        <h2 className="h2">{t("Your request")}</h2>
        <div className="field">
          <span className="label" id="urgLbl">{t("Urgency")}</span>
          <div className="seg urgency" role="group" aria-labelledby="urgLbl">
            {(["Emergency", "Urgent", "Routine"] as Urgency[]).map((u) => <button key={u} data-v={u} aria-pressed={review.urgency === u} onClick={() => set({ urgency: u })}>{t(u)}</button>)}
          </div>
          <span className="hint">{ai ? (review.urgency !== ai.urgency ? t("You changed this from {level}. Your manager will see both.", { level: t(ai.urgency) }) : t("Suggested by the AI. Change it if it's wrong.")) : t("Pick the level that fits.")}
            {lowered && floorYes.length > 0 ? ` ${t("You answered yes to a safety question, so double-check this.")}` : ""}</span>
        </div>
        <Field label={t("Category")} htmlFor={ids.c}><select id={ids.c} className="select" value={review.category} onChange={(e) => set({ category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(c)}</option>)}</select></Field>
        <Field label={t("Title")} htmlFor={ids.t}><input id={ids.t} className="input" value={review.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label={t("Message to maintenance")} htmlFor={ids.b}>
          <textarea id={ids.b} className="textarea" style={{ minHeight: 180 }} value={review.body} onChange={(e) => set({ body: e.target.value })} />
          {blanks.length > 0 && <span className="hint" style={{ color: "var(--urg)", fontWeight: 600 }}>{blanks.length === 1 ? t("1 detail to fill in, like {example}. You'll be asked when you send.", { example: blanks[0] }) : t("{n} details to fill in, like {example}. You'll be asked when you send.", { n: blanks.length, example: blanks[0] })}</span>}
        </Field>
        {ai && ai.questions.length > 0 && (
          <div className="stack-sm">
            <span className="label">{t("Maintenance will likely ask")}</span>
            {ai.questions.map((q, i) => (
              <div key={q} className="field"><label className="small" htmlFor={`qa-${i}`} style={{ fontWeight: 550 }}>{q}</label>
                <input id={`qa-${i}`} className="input" placeholder={t("Your answer (optional)")} value={review.answers[i] || ""} onChange={(e) => { const a = review.answers.slice(); a[i] = e.target.value; set({ answers: a }); }} /></div>
            ))}
          </div>
        )}
      </section>
      <section className="card pad stack">
        <div><h2 className="h2">{t("Access")}</h2><p className="hint" style={{ margin: "4px 0 0" }}>{t("Helps maintenance plan the visit. All optional, and remembered for next time on this phone.")}</p></div>
        <div className="between"><span id="entryLbl" style={{ fontWeight: 550 }}>{t("Can maintenance enter if you're not home?")}</span><YesNo neutral labelledBy="entryLbl" value={review.entry} onChange={(v) => set({ entry: v })} /></div>
        {review.entry && <Field label={t("Entry notes")} optional htmlFor={ids.n}><input id={ids.n} className="input" placeholder={t("Alarm code, dog in crate, knock first…")} value={review.entryNotes} onChange={(e) => set({ entryNotes: e.target.value })} /></Field>}
        <div className="between"><span id="petLbl" style={{ fontWeight: 550 }}>{t("Any pets in the home?")}</span><YesNo neutral labelledBy="petLbl" value={review.pets} onChange={(v) => set({ pets: v })} /></div>
        <Field label={t("Gate, lockbox or parking notes")} optional htmlFor={ids.a}><input id={ids.a} className="input" maxLength={300} placeholder={t("Gate code 1234, park in visitor spots, building B side door")} value={review.accessNotes} onChange={(e) => set({ accessNotes: e.target.value })} /></Field>
        <div className="field"><span className="label">{t("Best times for a visit")}</span>
          <div className="row-wrap">{TIMES.map((x) => <button key={x} type="button" className="chip" aria-pressed={review.times.includes(x)} onClick={() => set({ times: review.times.includes(x) ? review.times.filter((y) => y !== x) : [...review.times, x] })}>{t(x)}</button>)}</div></div>
      </section>
      {hasVideo && <p className="hint" style={{ margin: 0 }}><Icon name="video" width={14} height={14} style={{ verticalAlign: -2 }} /> {t("Your video is sent with the request.")}</p>}
      {err && <p className="err" role="alert"><Icon name="alert" width={16} height={16} />{err}</p>}
      <div className="actionbar">
        <Button block loading={!!submitting} icon="send" onClick={() => {
          if (blanks.length) { setFills({}); setFillOpen(true); return; }
          onSubmit();
        }}>{busyLabel || sendLabel}</Button>
      </div>
      <Sheet open={fillOpen} onClose={() => setFillOpen(false)} title={t("A few details first")}>
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); fillAndSend(); }}>
          <p className="muted" style={{ margin: 0 }}>{t("Your message has blanks maintenance will want filled in. Answer what you can; your answers go into the message.")}</p>
          {blanks.map((b, i) => (
            <Field key={b} label={blankLabel(b)} htmlFor={`blank-${i}`}>
              <input id={`blank-${i}`} className="input" value={fills[b] || ""} onChange={(e) => setFills({ ...fills, [b]: e.target.value })} />
            </Field>
          ))}
          <Button type="submit" block icon="send" loading={!!submitting}>{t("Add to message and send")}</Button>
          <button type="button" className="btn ghost sm" onClick={() => { setFillOpen(false); onSubmit(); }}>{t("Send without them")}</button>
        </form>
      </Sheet>
    </div>
  );
}

function DoneStep({ done, urgency, afterHoursLine, onNew, onView }: {
  done: { id: string; ref: string; place: Place; text: string; subject: string }; urgency: Urgency; afterHoursLine?: string | null; onNew: () => void; onView: () => void;
}) {
  const { t, tx } = useT();
  const p = done.place;
  const ext = p.kind === "external" ? p.place : null;
  const [shared, setShared] = useState(false);
  const canShare = typeof navigator.share === "function";
  const next = urgency === "Emergency" ? { t: t("Call now"), d: afterHoursLine ? tx("After-hours line: {phone}. The written request doesn't replace the call.", { phone: <a className="tel mono" href={telHref(afterHoursLine)}>{afterHoursLine}</a> }) : t("Call your after-hours maintenance line. The written request doesn't replace the call.") }
    : urgency === "Urgent" ? { t: t("You can go to bed"), d: t("Maintenance should pick this up first thing in the morning.") } : { t: t("All set"), d: t("This gets scheduled during business hours.") };
  const landlord = ext?.contact_name || t("your landlord");
  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <span className="avatar" style={{ width: 52, height: 52, background: "var(--rout-bg)", color: "var(--rout)" }}><Icon name="check" width={26} height={26} /></span>
        <h1 className="h1">{ext ? t("Your request is ready to send") : t("Sent to {place}", { place: p.label })}</h1>
        <p className="lede">{ext ? t("Choose how to send it to {name}. Your email or texting app opens with everything filled in; tap send there.", { name: landlord }) : t("Your manager has it now. You'll see updates and messages on the request.")}</p>
      </div>
      <div className={`verdict ${urgency}`}><div className="lvl" style={{ fontSize: 22 }}>{next.t}</div><div className="small">{next.d}</div></div>
      {urgency === "Emergency" && afterHoursLine && <a className="btn danger block" href={telHref(afterHoursLine)}><Icon name="phone" />{t("Call the after-hours line")}</a>}
      {ext && (
        <div className="stack-sm">
          {canShare && <Button block icon="share" onClick={async () => {
            try { await navigator.share({ title: done.subject, text: done.text }); setShared(true); } catch { /* closed */ }
          }}>{shared ? t("Opened. Send it there") : t("Send with another app…")}</Button>}
          {ext.contact_email && <a className="btn secondary block" href={`mailto:${ext.contact_email.replace(/[^\w.+@-]/g, "")}?subject=${encodeURIComponent(done.subject)}&body=${encodeURIComponent(done.text)}`}><Icon name="mail" />{t("Email {name}", { name: ext.contact_name || t("landlord") })}</a>}
          {ext.contact_phone && <a className="btn secondary block" href={`sms:${ext.contact_phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(done.text)}`}><Icon name="phone" />{t("Text {name}", { name: ext.contact_name || t("landlord") })}</a>}
          <span className="hint">{t("Email and text can't attach the photo automatically. Add it from your camera roll in the message.")}</span>
        </div>
      )}
      <div className="card pad stack-sm"><div className="between"><span className="mono muted">{done.ref}</span><span className="xs muted">{t("Saved to your requests")}</span></div>
        <div className="body-text small" style={{ maxHeight: 220, overflow: "auto" }}>{done.text}</div></div>
      <div className="actionbar">
        <Button block variant="secondary" onClick={onView}>{t("View request")}</Button>
        <Button block onClick={onNew} icon="plus">{t("Report something else")}</Button>
      </div>
    </div>
  );
}
