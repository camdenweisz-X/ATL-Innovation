import { useCallback, useEffect, useId, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase, friendly } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useT } from "../lib/i18n";
import { when, initials } from "../lib/format";
import type { Property, PropertySettings } from "../lib/types";
import { Button, CopyButton, Empty, Field, Sheet, Skeleton, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { TopBar } from "../AppShell";
import { CreatePropertyForm, JoinForm } from "../shared-screens/PlaceForms";
import { SampleButton } from "./Inbox";

export function PropertiesList() {
  const { managed, refresh } = useSession();
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("new") === "1");
  const [joinOpen, setJoinOpen] = useState(false);
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});
  const nav = useNavigate();
  useEffect(() => {
    if (!managed.length) return;
    supabase.from("requests").select("property_id").in("property_id", managed.map((p) => p.id)).in("status", ["new", "acknowledged", "scheduled", "in_progress"])
      .then(({ data }) => { const c: Record<string, number> = {}; (data || []).forEach((r) => { c[r.property_id] = (c[r.property_id] || 0) + 1; }); setOpenCounts(c); });
  }, [managed]);
  return (
    <>
      <TopBar title={t("Properties")} right={<button className="icon-btn" aria-label={t("Add property")} onClick={() => setOpen(true)}><Icon name="plus" /></button>} />
      <div className="page stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div><h1 className="h1">{t("Properties")}</h1><p className="lede">{t("Share each property's code with its residents. Invite co-managers with the team code.")}</p></div>
          <div className="row desktop-only"><Button variant="secondary" size="sm" onClick={() => setJoinOpen(true)}>{t("Join a team")}</Button><Button size="sm" icon="plus" onClick={() => setOpen(true)}>{t("Add property")}</Button></div>
        </div>
        {managed.length === 0 ? (
          <Empty icon="building" title={t("No properties yet")} action={<Button onClick={() => setOpen(true)} icon="plus">{t("Add property")}</Button>}>{t("Add a property to get a code for your residents.")}</Empty>
        ) : (
          <div className="list">
            {managed.map((p) => (
              <Link key={p.id} to={`/m/properties/${p.id}`} className="list-row">
                <span className="avatar" style={{ borderRadius: 10 }}><Icon name="building" width={18} height={18} /></span>
                <div className="grow"><div style={{ fontWeight: 650 }}>{p.name}</div><div className="small muted">{p.address || t("No address")} · {t("{n} open", { n: openCounts[p.id] || 0 })}</div></div>
                <Icon name="chevronRight" />
              </Link>
            ))}
          </div>
        )}
        <button className="btn ghost sm mobile-only" style={{ alignSelf: "flex-start" }} onClick={() => setJoinOpen(true)}>{t("Join another manager's team")}</button>
        {!managed.some((p) => p.name.startsWith("Sample data")) && (
          <div className="card pad row" style={{ alignItems: "flex-start" }}>
            <div className="grow small"><b>{t("Trying CanItWait out?")}</b><div className="muted">{t("Load a separate sample property with six weeks of requests, repeat problems and a filled-in Insights screen. Delete it any time.")}</div></div>
            <SampleButton onDone={refresh} />
          </div>
        )}
      </div>
      <Sheet open={open} onClose={() => { setOpen(false); setParams({}); }} title={t("Add a property")}>
        <CreatePropertyForm onDone={async (id) => { await refresh(); setOpen(false); nav(`/m/properties/${id}`); }} />
      </Sheet>
      <Sheet open={joinOpen} onClose={() => setJoinOpen(false)} title={t("Join a team")}>
        <p className="muted" style={{ marginTop: 0 }}>{t("Enter the co-manager code another manager shared with you. It starts with M-.")}</p>
        <JoinForm initialCode="" onDone={async () => { await refresh(); setJoinOpen(false); }} />
      </Sheet>
    </>
  );
}

interface Person { membership_id: string; user_id: string; role: "manager" | "resident"; unit: string | null; full_name: string; joined_at: string }

export function PropertyDetail() {
  const { id } = useParams();
  const { managed, refresh, user } = useSession();
  const { t, tx } = useT();
  const toast = useToast();
  const nav = useNavigate();
  const prop = managed.find((p) => p.id === id);
  const [codes, setCodes] = useState<{ resident_code: string; manager_code: string } | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState<null | "rotate" | "delete" | { remove: Person }>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: c }, { data: ppl }] = await Promise.all([
      supabase.from("property_codes").select("resident_code, manager_code").eq("property_id", id).maybeSingle(),
      supabase.rpc("property_people", { p_property: id }),
    ]);
    setCodes(c); setPeople((ppl as Person[]) || []);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (!prop) return <div className="page"><Empty icon="building" title={t("Property not found")}>{t("You may not manage this property anymore.")}</Empty></div>;
  const link = codes ? `${window.location.origin}/join/${codes.resident_code}` : "";
  const residents = (people || []).filter((p) => p.role === "resident");
  const managers = (people || []).filter((p) => p.role === "manager");

  const act = async () => {
    setBusy(true);
    try {
      if (confirm === "rotate") { const { error } = await supabase.rpc("rotate_codes", { p_property: prop.id }); if (error) throw error; toast(t("New codes created. Old codes no longer work.")); await load(); }
      else if (confirm === "delete") { const { error } = await supabase.from("properties").delete().eq("id", prop.id); if (error) throw error; await refresh(); toast(t("Property deleted")); nav("/m/properties"); }
      else if (confirm && "remove" in confirm) { const { error } = await supabase.rpc("remove_membership", { p_membership: confirm.remove.membership_id }); if (error) throw error; toast(t("Removed")); if (confirm.remove.user_id === user?.id) { await refresh(); nav("/m/properties"); } else await load(); }
      setConfirm(null); setTyped("");
    } catch (e) { toast(friendly(e), "error"); } finally { setBusy(false); }
  };

  return (
    <>
      <TopBar title={prop.name} back={() => nav("/m/properties")} />
      <div className="page stack-lg">
        <Link to="/m/properties" className="btn ghost sm desktop-only" style={{ alignSelf: "flex-start", marginLeft: -8 }}><Icon name="chevronLeft" />{t("Properties")}</Link>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div><h1 className="h1">{prop.name}</h1><p className="lede">{prop.address || t("No address")}{prop.after_hours_phone ? ` · ${t("After hours {phone}", { phone: prop.after_hours_phone })}` : ""}</p></div>
          <Button variant="secondary" size="sm" icon="edit" onClick={() => setEdit(true)}>{t("Edit")}</Button>
        </div>

        <section className="card pad stack">
          <div><h2 className="h2">{t("Invite residents")}</h2><p className="hint" style={{ margin: "4px 0 0" }}>{t("Residents enter this code when they sign up, or open the link.")}</p></div>
          {!codes ? <Skeleton h={48} n={1} /> : (<>
            <div className="code-box"><span className="code">{codes.resident_code}</span><CopyButton text={codes.resident_code} /></div>
            <div className="row-wrap">
              <CopyButton text={link} label={t("Copy invite link")} />
              {typeof navigator.share === "function" && <Button variant="secondary" size="sm" icon="share" onClick={() => navigator.share({ title: t("Join {place} on CanItWait", { place: prop.name }), text: t("Report maintenance problems for {place} with CanItWait (English or Spanish). Your code is {code}.", { place: prop.name, code: codes.resident_code }), url: link }).catch(() => {})}>{t("Share")}</Button>}
            </div>
          </>)}
        </section>

        <section className="card pad stack">
          <div><h2 className="h2">{t("Co-managers")}</h2><p className="hint" style={{ margin: "4px 0 0" }}>{t("Anyone with this code can manage {place}, including all of its requests. Share it only with your team.", { place: prop.name })}</p></div>
          {codes && <div className="code-box"><span className="code">{codes.manager_code}</span><CopyButton text={codes.manager_code} /></div>}
          <div className="list">
            {managers.map((m) => (
              <div key={m.membership_id} className="list-row" style={{ cursor: "default" }}>
                <span className="avatar">{initials(m.full_name || "?")}</span>
                <div className="grow"><div style={{ fontWeight: 600 }}>{m.full_name || t("Unnamed")}{m.user_id === user?.id ? ` (${t("you")})` : ""}</div><div className="xs muted">{t("Manager since {date}", { date: when(m.joined_at).split(",").slice(0, 2).join(",") })}</div></div>
                {(m.user_id !== user?.id || managers.length > 1) && <button className="btn ghost sm" onClick={() => setConfirm({ remove: m })}>{m.user_id === user?.id ? t("Leave") : t("Remove")}</button>}
              </div>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2 className="section-title">{t("Residents ({n})", { n: residents.length })}</h2>
          {!people ? <Skeleton h={56} n={2} /> : residents.length === 0 ? (
            <Empty icon="users" title={t("No residents yet")}>{t("Share the invite code above. Residents appear here as they join.")}</Empty>
          ) : (
            <div className="list">
              {residents.map((m) => (
                <div key={m.membership_id} className="list-row" style={{ cursor: "default" }}>
                  <span className="avatar">{initials(m.full_name || "?")}</span>
                  <div className="grow"><div style={{ fontWeight: 600 }}>{m.full_name || t("Unnamed")}</div><div className="xs muted">{m.unit || t("No unit")}</div></div>
                  <button className="btn ghost sm" onClick={() => setConfirm({ remove: m })}>{t("Remove")}</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <EmergencySettings prop={prop} />

        <section className="card pad stack-sm">
          <h2 className="h3">{t("Security")}</h2>
          <p className="small muted" style={{ margin: 0 }}>{t("If a code was shared with the wrong person, create new codes. People who already joined stay connected.")}</p>
          <div className="row-wrap"><Button variant="secondary" size="sm" icon="refresh" onClick={() => setConfirm("rotate")}>{t("Create new codes")}</Button>
            <Button variant="danger-outline" size="sm" icon="trash" onClick={() => setConfirm("delete")}>{t("Delete property")}</Button></div>
        </section>
      </div>

      <EditProperty open={edit} prop={prop} onClose={() => setEdit(false)} onSaved={async () => { await refresh(); setEdit(false); toast(t("Saved")); }} />
      <Sheet open={!!confirm} onClose={() => { setConfirm(null); setTyped(""); }} title={confirm === "rotate" ? t("Create new codes?") : confirm === "delete" ? t("Delete this property?") : t("Remove this person?")}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            {confirm === "rotate" && t("The current resident and co-manager codes stop working right away. Share the new ones with anyone who still needs to join.")}
            {confirm === "delete" && t("This permanently deletes {place}, all of its requests and messages, and removes everyone from it.", { place: prop.name })}
            {confirm && typeof confirm === "object" && (confirm.remove.role === "resident"
              ? t("{name} will lose access to {place}. Their past requests stay in your inbox.", { name: confirm.remove.full_name || t("This person"), place: prop.name })
              : t("{name} will lose access to {place}.", { name: confirm.remove.full_name || t("This person"), place: prop.name }))}
          </p>
          {confirm === "delete" && <Field label={tx("Type {name} to confirm", { name: prop.name })} htmlFor="prop-del-confirm"><input id="prop-del-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>}
          <Button block variant={confirm === "rotate" ? "primary" : "danger"} loading={busy} disabled={confirm === "delete" && typed.trim() !== prop.name} onClick={act}>
            {confirm === "rotate" ? t("Create new codes") : confirm === "delete" ? t("Delete property") : t("Remove")}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function EditProperty({ open, prop, onClose, onSaved }: { open: boolean; prop: Property; onClose: () => void; onSaved: () => void }) {
  const { t } = useT();
  const [f, setF] = useState({ name: prop.name, address: prop.address || "", after_hours_phone: prop.after_hours_phone || "" });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const ids = { n: useId(), a: useId(), l: useId() };
  useEffect(() => { if (open) setF({ name: prop.name, address: prop.address || "", after_hours_phone: prop.after_hours_phone || "" }); }, [open, prop]);
  return (
    <Sheet open={open} onClose={onClose} title={t("Edit property")}>
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        if (!f.name.trim()) return setErr(t("Add the property name."));
        setBusy(true);
        const { error } = await supabase.from("properties").update({ name: f.name.trim(), address: f.address.trim() || null, after_hours_phone: f.after_hours_phone.trim() || null }).eq("id", prop.id);
        setBusy(false);
        if (error) return setErr(friendly(error));
        onSaved();
      }}>
        <Field label={t("Property name")} htmlFor={ids.n}><input id={ids.n} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t("Address")} optional htmlFor={ids.a}><input id={ids.a} className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label={t("After-hours emergency line")} optional htmlFor={ids.l}><input id={ids.l} className="input" type="tel" value={f.after_hours_phone} onChange={(e) => setF({ ...f, after_hours_phone: e.target.value })} /></Field>
        {err && <p className="err" role="alert">{err}</p>}
        <Button type="submit" block loading={busy}>{t("Save")}</Button>
      </form>
    </Sheet>
  );
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Who gets called when an emergency sits unacknowledged, and where copies of new requests go. Managers only. */
function EmergencySettings({ prop }: { prop: Property }) {
  const { t } = useT();
  const toast = useToast();
  const [f, setF] = useState({ backup_name: "", backup_phone: "", backup_email: "", escalate_after_min: "10", forward_email: "" });
  const [saved, setSaved] = useState<typeof f | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ids = { n: useId(), p: useId(), e: useId(), m: useId(), f: useId() };
  useEffect(() => {
    supabase.from("property_settings").select("*").eq("property_id", prop.id).maybeSingle().then(({ data }) => {
      const s = data as PropertySettings | null;
      const v = { backup_name: s?.backup_name || "", backup_phone: s?.backup_phone || "", backup_email: s?.backup_email || "", escalate_after_min: String(s?.escalate_after_min ?? 10), forward_email: s?.forward_email || "" };
      setF(v); setSaved(v);
    });
  }, [prop.id]);
  const dirty = !!saved && JSON.stringify(f) !== JSON.stringify(saved);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="card pad stack">
      <div><h2 className="h2">{t("Emergency backup and forwarding")}</h2>
        <p className="hint" style={{ margin: "4px 0 0" }}>{t("Every manager gets emergencies by phone notification, email and (if set up) text. If nobody acknowledges one in time, CanItWait texts and emails your backup contact and tells the resident to call.")}</p></div>
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        if (f.backup_email && !EMAIL_OK.test(f.backup_email.trim())) return setErr(t("The backup email doesn't look right."));
        if (f.forward_email && !EMAIL_OK.test(f.forward_email.trim())) return setErr(t("The forwarding email doesn't look right."));
        setBusy(true);
        const row = { property_id: prop.id, backup_name: f.backup_name.trim() || null, backup_phone: f.backup_phone.trim() || null, backup_email: f.backup_email.trim() || null,
          escalate_after_min: Number(f.escalate_after_min) || 10, forward_email: f.forward_email.trim() || null, updated_at: new Date().toISOString() };
        const { error } = await supabase.from("property_settings").upsert(row, { onConflict: "property_id" });
        setBusy(false);
        if (error) return setErr(friendly(error));
        setSaved(f); toast(t("Saved"));
      }}>
        <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Field label={t("Backup contact name")} optional htmlFor={ids.n}><input id={ids.n} className="input" maxLength={80} placeholder={t("On-call supervisor")} value={f.backup_name} onChange={set("backup_name")} /></Field>
          <Field label={t("Backup phone (texts)")} optional htmlFor={ids.p}><input id={ids.p} className="input" type="tel" inputMode="tel" maxLength={30} placeholder="(404) 555-0199" value={f.backup_phone} onChange={set("backup_phone")} /></Field>
          <Field label={t("Backup email")} optional htmlFor={ids.e}><input id={ids.e} className="input" type="email" inputMode="email" maxLength={120} value={f.backup_email} onChange={set("backup_email")} /></Field>
          <Field label={t("Escalate after")} htmlFor={ids.m}>
            <select id={ids.m} className="select" value={f.escalate_after_min} onChange={set("escalate_after_min")}>
              {[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{t("{n} minutes", { n: m })}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t("Also send new requests to")} optional hint={t("For example, your AppFolio, Buildium or Yardi maintenance inbox, or a shared team address. Each new request arrives there as a work order.")} htmlFor={ids.f}>
          <input id={ids.f} className="input" type="email" inputMode="email" maxLength={120} placeholder="maintenance@yourcompany.com" value={f.forward_email} onChange={set("forward_email")} />
        </Field>
        {err && <p className="err" role="alert">{err}</p>}
        <div><Button type="submit" size="sm" loading={busy} disabled={!dirty}>{t("Save")}</Button></div>
      </form>
    </section>
  );
}
