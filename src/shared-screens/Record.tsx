import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase, PHOTO_BUCKET } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useT } from "../lib/i18n";
import { stampLong } from "../lib/format";
import { finalUrgency } from "../../shared/workorders.js";
import { STATUS_LABEL } from "../../shared/triage.js";
import type { RequestEvent, RequestRow } from "../lib/types";
import { Button, Spinner, Empty } from "../ui/kit";
import { Icon } from "../ui/icons";
import { eventText } from "./RequestDetail";

interface Item { r: RequestRow; events: RequestEvent[]; photo: string | null }

/**
 * A printable record of one request (or all of a resident's requests): what was reported, when, to whom,
 * and every update since, with exact timestamps. "Save as PDF" in the print dialog keeps a copy.
 * Entry and gate notes are left out, since records get shared.
 */
export function RequestRecord() {
  const { id } = useParams();
  const { user, profile, memberships, externalPlaces, managed } = useSession();
  const { t } = useT();
  const nav = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      let q = supabase.from("requests").select("*").order("created_at", { ascending: true });
      q = id === "all" ? q.eq("resident_id", user!.id).limit(200) : q.eq("id", id!);
      const { data: rows } = await q;
      const list = (rows as RequestRow[]) || [];
      const ids = list.map((r) => r.id);
      const evs: RequestEvent[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await supabase.from("request_events").select("*").in("request_id", ids.slice(i, i + 100)).order("created_at");
        evs.push(...((data as RequestEvent[]) || []));
      }
      const paths = list.map((r) => r.photo_path).filter(Boolean) as string[];
      const signed = paths.length ? (await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)).data || [] : [];
      const people = Array.from(new Set([...list.map((r) => r.resident_id), ...evs.map((e) => e.actor_id).filter(Boolean)])) as string[];
      const { data: ps } = people.length ? await supabase.from("profiles").select("id, full_name").in("id", people) : { data: [] };
      if (!alive) return;
      setNames(Object.fromEntries((ps || []).map((p) => [p.id, p.full_name])));
      setItems(list.map((r) => ({ r, events: evs.filter((e) => e.request_id === r.id), photo: signed.find((s) => s.path === r.photo_path)?.signedUrl || null })));
    })();
    return () => { alive = false; };
  }, [id, user]);

  if (!items) return <div style={{ paddingTop: "30vh" }}><Spinner /></div>;
  const placeOf = (r: RequestRow) => memberships.find((m) => m.property_id === r.property_id)?.property?.name || managed.find((p) => p.id === r.property_id)?.name || externalPlaces.find((e) => e.id === r.external_place_id)?.label || "";
  const sentTo = (r: RequestRow) => r.property_id ? t("{place} (through CanItWait)", { place: placeOf(r) })
    : (() => { const e = externalPlaces.find((x) => x.id === r.external_place_id); return e ? t("{name}, by the resident's own email or text", { name: e.contact_name || e.contact_email || e.contact_phone || t("landlord") }) : ""; })();
  const who = (e: RequestEvent) => e.kind === "escalated" ? "CanItWait" : names[e.actor_id || ""] || t("Someone");

  return (
    <div className="record">
      <div className="record-bar no-print">
        <Button variant="ghost" size="sm" icon="chevronLeft" onClick={() => nav(-1)}>{t("Back")}</Button>
        <Button size="sm" icon="printer" onClick={() => window.print()}>{t("Print or save as PDF")}</Button>
      </div>
      <header className="record-head">
        <div className="brand"><span className="brand-mark"><Icon name="brand" /></span><span>Can<span className="brand-it">It</span>Wait</span></div>
        <h1>{items.length === 1 ? t("Maintenance request record") : t("Maintenance request records")}</h1>
        <p>{t("Prepared {time}", { time: stampLong(new Date().toISOString()) })}{profile?.full_name ? ` · ${profile.full_name}` : ""}</p>
      </header>
      {items.length === 0 && <Empty icon="list" title={t("No requests yet")} />}
      {items.map(({ r, events, photo }) => (
        <article key={r.id} className="record-item">
          <h2>{r.title} <span className="mono">{r.ref}</span></h2>
          <table className="record-facts"><tbody>
            <tr><th>{t("Reported")}</th><td>{stampLong(r.created_at)}{r.after_hours ? ` · ${t("after hours")}` : ""}</td></tr>
            <tr><th>{t("Reported by")}</th><td>{names[r.resident_id] || ""}</td></tr>
            <tr><th>{t("Home")}</th><td>{placeOf(r)}{r.unit ? ` · ${r.unit}` : ""}</td></tr>
            <tr><th>{t("Sent to")}</th><td>{sentTo(r)}</td></tr>
            <tr><th>{t("Category")}</th><td>{t(r.category)}{r.location_in_home ? ` · ${t(r.location_in_home)}` : ""}</td></tr>
            <tr><th>{t("Urgency")}</th><td>{t(finalUrgency(r))}{r.ai_urgency ? ` (${t("AI check")}: ${t(r.ai_urgency)})` : ""}</td></tr>
            <tr><th>{t("Status")}</th><td>{t(STATUS_LABEL[r.status])}</td></tr>
            {r.entry_permission !== null && <tr><th>{t("Permission to enter")}</th><td>{t(r.entry_permission ? "Yes" : "No")}</td></tr>}
          </tbody></table>
          <div className="record-body">{r.body}</div>
          {r.answers?.length > 0 && <ul className="record-answers">{r.answers.map((a) => <li key={a.q}><b>{a.q}</b> {a.a}</li>)}</ul>}
          {photo && <img className="record-photo" src={photo} alt={t("Photo of the problem")} />}
          {r.video_path && <p className="record-note">{t("A video was attached. It can be viewed in CanItWait.")}</p>}
          <h3>{t("History")}</h3>
          <table className="record-log"><tbody>
            {events.map((e) => {
              const x = eventText(e, t);
              const body = e.kind === "urgency" ? e.detail?.note : e.kind === "escalated" ? null : e.body;
              return <tr key={e.id}><td className="when">{stampLong(e.created_at)}</td><td><b>{who(e)}</b> {x.text}{body ? <div className="record-msg">“{body}”</div> : null}</td></tr>;
            })}
          </tbody></table>
        </article>
      ))}
      <footer className="record-foot">
        <p>{t("Times are recorded by CanItWait's server when each event happens and can't be edited by the resident or the manager. Messages appear as written.")}</p>
        <p>{t("This record is provided for your information and is not legal advice.")}</p>
      </footer>
    </div>
  );
}
