import { useCallback, useEffect, useId, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase, friendly } from "../lib/supabase";
import { useSession } from "../lib/session";
import { when, initials } from "../lib/format";
import type { Property } from "../lib/types";
import { Button, CopyButton, Empty, Field, Sheet, Skeleton, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { TopBar } from "../AppShell";
import { CreatePropertyForm, JoinForm } from "../shared-screens/PlaceForms";
import { SampleButton } from "./Inbox";

export function PropertiesList() {
  const { managed, refresh } = useSession();
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
      <TopBar title="Properties" right={<button className="icon-btn" aria-label="Add property" onClick={() => setOpen(true)}><Icon name="plus" /></button>} />
      <div className="page stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div><h1 className="h1">Properties</h1><p className="lede">Share each property's code with its residents. Invite co-managers with the team code.</p></div>
          <div className="row desktop-only"><Button variant="secondary" size="sm" onClick={() => setJoinOpen(true)}>Join a team</Button><Button size="sm" icon="plus" onClick={() => setOpen(true)}>Add property</Button></div>
        </div>
        {managed.length === 0 ? (
          <Empty icon="building" title="No properties yet" action={<Button onClick={() => setOpen(true)} icon="plus">Add property</Button>}>Add a property to get a code for your residents.</Empty>
        ) : (
          <div className="list">
            {managed.map((p) => (
              <Link key={p.id} to={`/m/properties/${p.id}`} className="list-row">
                <span className="avatar" style={{ borderRadius: 10 }}><Icon name="building" width={18} height={18} /></span>
                <div className="grow"><div style={{ fontWeight: 650 }}>{p.name}</div><div className="small muted">{p.address || "No address"} · {openCounts[p.id] || 0} open</div></div>
                <Icon name="chevronRight" />
              </Link>
            ))}
          </div>
        )}
        <button className="btn ghost sm mobile-only" style={{ alignSelf: "flex-start" }} onClick={() => setJoinOpen(true)}>Join another manager's team</button>
        {!managed.some((p) => p.name.startsWith("Sample data")) && (
          <div className="card pad row" style={{ alignItems: "flex-start" }}>
            <div className="grow small"><b>Trying CanItWait out?</b><div className="muted">Load a separate sample property with six weeks of requests, repeat problems and a filled-in Insights screen. Delete it any time.</div></div>
            <SampleButton onDone={refresh} />
          </div>
        )}
      </div>
      <Sheet open={open} onClose={() => { setOpen(false); setParams({}); }} title="Add a property">
        <CreatePropertyForm onDone={async (id) => { await refresh(); setOpen(false); nav(`/m/properties/${id}`); }} />
      </Sheet>
      <Sheet open={joinOpen} onClose={() => setJoinOpen(false)} title="Join a team">
        <p className="muted" style={{ marginTop: 0 }}>Enter the co-manager code another manager shared with you. It starts with M-.</p>
        <JoinForm initialCode="" onDone={async () => { await refresh(); setJoinOpen(false); }} />
      </Sheet>
    </>
  );
}

interface Person { membership_id: string; user_id: string; role: "manager" | "resident"; unit: string | null; full_name: string; joined_at: string }

export function PropertyDetail() {
  const { id } = useParams();
  const { managed, refresh, user } = useSession();
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

  if (!prop) return <div className="page"><Empty icon="building" title="Property not found">You may not manage this property anymore.</Empty></div>;
  const link = codes ? `${window.location.origin}/join/${codes.resident_code}` : "";
  const residents = (people || []).filter((p) => p.role === "resident");
  const managers = (people || []).filter((p) => p.role === "manager");

  const act = async () => {
    setBusy(true);
    try {
      if (confirm === "rotate") { const { error } = await supabase.rpc("rotate_codes", { p_property: prop.id }); if (error) throw error; toast("New codes created. Old codes no longer work."); await load(); }
      else if (confirm === "delete") { const { error } = await supabase.from("properties").delete().eq("id", prop.id); if (error) throw error; await refresh(); toast("Property deleted"); nav("/m/properties"); }
      else if (confirm && "remove" in confirm) { const { error } = await supabase.rpc("remove_membership", { p_membership: confirm.remove.membership_id }); if (error) throw error; toast("Removed"); if (confirm.remove.user_id === user?.id) { await refresh(); nav("/m/properties"); } else await load(); }
      setConfirm(null); setTyped("");
    } catch (e) { toast(friendly(e), "error"); } finally { setBusy(false); }
  };

  return (
    <>
      <TopBar title={prop.name} back={() => nav("/m/properties")} />
      <div className="page stack-lg">
        <Link to="/m/properties" className="btn ghost sm desktop-only" style={{ alignSelf: "flex-start", marginLeft: -8 }}><Icon name="chevronLeft" />Properties</Link>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div><h1 className="h1">{prop.name}</h1><p className="lede">{prop.address || "No address"}{prop.after_hours_phone ? ` · After hours ${prop.after_hours_phone}` : ""}</p></div>
          <Button variant="secondary" size="sm" icon="edit" onClick={() => setEdit(true)}>Edit</Button>
        </div>

        <section className="card pad stack">
          <div><h2 className="h2">Invite residents</h2><p className="hint" style={{ margin: "4px 0 0" }}>Residents enter this code when they sign up, or open the link.</p></div>
          {!codes ? <Skeleton h={48} n={1} /> : (<>
            <div className="code-box"><span className="code">{codes.resident_code}</span><CopyButton text={codes.resident_code} /></div>
            <div className="row-wrap">
              <CopyButton text={link} label="Copy invite link" />
              {typeof navigator.share === "function" && <Button variant="secondary" size="sm" icon="share" onClick={() => navigator.share({ title: `Join ${prop.name} on CanItWait`, text: `Report maintenance problems for ${prop.name} with CanItWait. Your code is ${codes.resident_code}.`, url: link }).catch(() => {})}>Share</Button>}
            </div>
          </>)}
        </section>

        <section className="card pad stack">
          <div><h2 className="h2">Co-managers</h2><p className="hint" style={{ margin: "4px 0 0" }}>Anyone with this code can manage {prop.name}, including all of its requests. Share it only with your team.</p></div>
          {codes && <div className="code-box"><span className="code">{codes.manager_code}</span><CopyButton text={codes.manager_code} /></div>}
          <div className="list">
            {managers.map((m) => (
              <div key={m.membership_id} className="list-row" style={{ cursor: "default" }}>
                <span className="avatar">{initials(m.full_name || "?")}</span>
                <div className="grow"><div style={{ fontWeight: 600 }}>{m.full_name || "Unnamed"}{m.user_id === user?.id ? " (you)" : ""}</div><div className="xs muted">Manager since {when(m.joined_at).split(",").slice(0, 2).join(",")}</div></div>
                {(m.user_id !== user?.id || managers.length > 1) && <button className="btn ghost sm" onClick={() => setConfirm({ remove: m })}>{m.user_id === user?.id ? "Leave" : "Remove"}</button>}
              </div>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2 className="section-title">Residents ({residents.length})</h2>
          {!people ? <Skeleton h={56} n={2} /> : residents.length === 0 ? (
            <Empty icon="users" title="No residents yet">Share the invite code above. Residents appear here as they join.</Empty>
          ) : (
            <div className="list">
              {residents.map((m) => (
                <div key={m.membership_id} className="list-row" style={{ cursor: "default" }}>
                  <span className="avatar">{initials(m.full_name || "?")}</span>
                  <div className="grow"><div style={{ fontWeight: 600 }}>{m.full_name || "Unnamed"}</div><div className="xs muted">{m.unit || "No unit"}</div></div>
                  <button className="btn ghost sm" onClick={() => setConfirm({ remove: m })}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card pad stack-sm">
          <h2 className="h3">Security</h2>
          <p className="small muted" style={{ margin: 0 }}>If a code was shared with the wrong person, create new codes. People who already joined stay connected.</p>
          <div className="row-wrap"><Button variant="secondary" size="sm" icon="refresh" onClick={() => setConfirm("rotate")}>Create new codes</Button>
            <Button variant="danger-outline" size="sm" icon="trash" onClick={() => setConfirm("delete")}>Delete property</Button></div>
        </section>
      </div>

      <EditProperty open={edit} prop={prop} onClose={() => setEdit(false)} onSaved={async () => { await refresh(); setEdit(false); toast("Saved"); }} />
      <Sheet open={!!confirm} onClose={() => { setConfirm(null); setTyped(""); }} title={confirm === "rotate" ? "Create new codes?" : confirm === "delete" ? "Delete this property?" : "Remove this person?"}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            {confirm === "rotate" && "The current resident and co-manager codes stop working right away. Share the new ones with anyone who still needs to join."}
            {confirm === "delete" && `This permanently deletes ${prop.name}, all of its requests and messages, and removes everyone from it.`}
            {confirm && typeof confirm === "object" && `${confirm.remove.full_name || "This person"} will lose access to ${prop.name}${confirm.remove.role === "resident" ? ". Their past requests stay in your inbox." : "."}`}
          </p>
          {confirm === "delete" && <Field label={`Type ${prop.name} to confirm`} htmlFor="prop-del-confirm"><input id="prop-del-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>}
          <Button block variant={confirm === "rotate" ? "primary" : "danger"} loading={busy} disabled={confirm === "delete" && typed.trim() !== prop.name} onClick={act}>
            {confirm === "rotate" ? "Create new codes" : confirm === "delete" ? "Delete property" : "Remove"}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function EditProperty({ open, prop, onClose, onSaved }: { open: boolean; prop: Property; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: prop.name, address: prop.address || "", after_hours_phone: prop.after_hours_phone || "" });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const ids = { n: useId(), a: useId(), l: useId() };
  useEffect(() => { if (open) setF({ name: prop.name, address: prop.address || "", after_hours_phone: prop.after_hours_phone || "" }); }, [open, prop]);
  return (
    <Sheet open={open} onClose={onClose} title="Edit property">
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        if (!f.name.trim()) return setErr("Add the property name.");
        setBusy(true);
        const { error } = await supabase.from("properties").update({ name: f.name.trim(), address: f.address.trim() || null, after_hours_phone: f.after_hours_phone.trim() || null }).eq("id", prop.id);
        setBusy(false);
        if (error) return setErr(friendly(error));
        onSaved();
      }}>
        <Field label="Property name" htmlFor={ids.n}><input id={ids.n} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Address" optional htmlFor={ids.a}><input id={ids.a} className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="After-hours emergency line" optional htmlFor={ids.l}><input id={ids.l} className="input" type="tel" value={f.after_hours_phone} onChange={(e) => setF({ ...f, after_hours_phone: e.target.value })} /></Field>
        {err && <p className="err" role="alert">{err}</p>}
        <Button type="submit" block loading={busy}>Save</Button>
      </form>
    </Sheet>
  );
}
