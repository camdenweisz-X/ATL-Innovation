import { useEffect, useId, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase, friendly } from "../lib/supabase";
import { useSession } from "../lib/session";
import { getTheme, setTheme, type ThemePref } from "../lib/theme";
import type { ExternalPlace, Membership } from "../lib/types";
import { Button, Field, Sheet, Switch, useToast, Empty } from "../ui/kit";
import { Icon } from "../ui/icons";
import { TopBar } from "../AppShell";
import { ExternalPlaceForm, JoinForm, CreatePropertyForm } from "../shared-screens/PlaceForms";

const APP_VERSION = "2.0";

export function Settings() {
  const { profile, user, refresh, signOut, places, managed, workspace, setWorkspace } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [name, setName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [saving, setSaving] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>(getTheme());
  const [pwOpen, setPwOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [addRole, setAddRole] = useState<null | "manager">(null);
  const ids = { n: useId(), p: useId() };
  const dirty = name !== (profile?.full_name || "") || phone !== (profile?.phone || "");
  const isGoogle = user?.app_metadata?.provider === "google";

  return (
    <>
      <TopBar title="Settings" />
      <div className="page stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}><h1 className="h1">Settings</h1></div>

        {places.length > 0 && managed.length > 0 && (
          <section className="stack-sm">
            <h2 className="section-title">Workspace</h2>
            <div className="seg" role="group" aria-label="Workspace">
              <button aria-pressed={workspace === "resident"} onClick={() => { setWorkspace("resident"); nav("/r"); }}>Resident</button>
              <button aria-pressed={workspace === "manager"} onClick={() => { setWorkspace("manager"); nav("/m"); }}>Manager</button>
            </div>
          </section>
        )}

        <section className="stack-sm">
          <h2 className="section-title">Account</h2>
          <div className="card pad stack">
            <Field label="Full name" htmlFor={ids.n}><input id={ids.n} className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Mobile number" optional hint="Shared with managers of properties you join. If you manage properties, your residents see it too." htmlFor={ids.p}><input id={ids.p} className="input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <div className="field"><span className="label">Email</span><div className="muted">{user?.email}{isGoogle ? " · signed in with Google" : ""}</div></div>
            <div className="row-wrap">
              <Button size="sm" disabled={!dirty || !name.trim()} loading={saving} onClick={async () => {
                setSaving(true);
                const { error } = await supabase.from("profiles").update({ full_name: name.trim(), phone: phone.trim() || null }).eq("id", user!.id);
                setSaving(false);
                if (error) return toast(friendly(error), "error");
                await refresh(); toast("Saved");
              }}>Save changes</Button>
              {!isGoogle && <Button size="sm" variant="secondary" icon="key" onClick={() => setPwOpen(true)}>Change password</Button>}
            </div>
          </div>
        </section>

        <section className="stack-sm">
          <h2 className="section-title">Homes and properties</h2>
          <div className="list">
            <Link to="/settings/places" className="list-row"><Icon name="home" width={20} height={20} /><div className="grow"><div style={{ fontWeight: 600 }}>My homes</div><div className="small muted">{places.length ? places.map((p) => p.label).join(", ") : "Add a home to report problems"}</div></div><Icon name="chevronRight" /></Link>
            {managed.length > 0 ? (
              <Link to="/m/properties" className="list-row" onClick={() => setWorkspace("manager")}><Icon name="building" width={20} height={20} /><div className="grow"><div style={{ fontWeight: 600 }}>Properties I manage</div><div className="small muted">{managed.map((p) => p.name).join(", ")}</div></div><Icon name="chevronRight" /></Link>
            ) : (
              <button className="list-row" onClick={() => setAddRole("manager")}><Icon name="building" width={20} height={20} /><div className="grow"><div style={{ fontWeight: 600 }}>Manage a property</div><div className="small muted">Add a property or join a team as a co-manager</div></div><Icon name="chevronRight" /></button>
            )}
          </div>
        </section>

        <section className="stack-sm">
          <h2 className="section-title">Notifications</h2>
          <div className="card">
            <div className="list-row" style={{ cursor: "default" }}>
              <Icon name="mail" width={20} height={20} />
              <div className="grow"><div style={{ fontWeight: 600 }}>Email updates</div><div className="small muted">New requests, status changes and messages.</div></div>
              <Switch label="Email updates" checked={profile?.notify_email ?? true} onChange={async (v) => {
                const { error } = await supabase.from("profiles").update({ notify_email: v }).eq("id", user!.id);
                if (error) toast(friendly(error), "error"); else { await refresh(); toast(v ? "Email updates on" : "Email updates off"); }
              }} />
            </div>
          </div>
        </section>

        <section className="stack-sm">
          <h2 className="section-title">Appearance</h2>
          <div className="seg" role="group" aria-label="Theme">
            {(["system", "light", "dark"] as ThemePref[]).map((t) => <button key={t} aria-pressed={theme === t} onClick={() => { setTheme(t); setThemeState(t); }}>{t === "system" ? "Match device" : t === "light" ? "Light" : "Dark"}</button>)}
          </div>
        </section>

        <section className="stack-sm">
          <h2 className="section-title">Privacy</h2>
          <div className="card pad small muted stack-sm">
            <p style={{ margin: 0 }}>Photos and descriptions are sent to Google's Gemini AI to suggest urgency. On the free tier Google may use them to improve its products, so don't include sensitive personal details.</p>
            <p style={{ margin: 0 }}>Your requests are visible only to you and the managers of the property you sent them to.</p>
            <p style={{ margin: 0 }}><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></p>
          </div>
        </section>

        <div className="stack-sm">
          <Button variant="secondary" block icon="logout" onClick={async () => { await signOut(); nav("/", { replace: true }); }}>Sign out</Button>
          <Button variant="danger-outline" block icon="trash" onClick={() => setDelOpen(true)}>Delete account</Button>
          <p className="xs muted center">CanItWait {APP_VERSION} · The InnovAItors</p>
        </div>
      </div>

      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
      <DeleteAccount open={delOpen} onClose={() => setDelOpen(false)} />
      <Sheet open={addRole === "manager"} onClose={() => setAddRole(null)} title="Manage a property">
        <div className="stack">
          <CreatePropertyForm onDone={async (id) => { await refresh(); setWorkspace("manager"); setAddRole(null); nav(`/m/properties/${id}`); }} />
          <div className="divider">or join a team</div>
          <JoinForm initialCode="" onDone={async () => { await refresh(); setWorkspace("manager"); setAddRole(null); nav("/m"); }} />
        </div>
      </Sheet>
    </>
  );
}

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const toast = useToast(); const pId = useId();
  return (
    <Sheet open={open} onClose={onClose} title="Change password">
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        if (pw.length < 8) return setErr("Use at least 8 characters.");
        setBusy(true);
        const { error } = await supabase.auth.updateUser({ password: pw });
        setBusy(false);
        if (error) return setErr(friendly(error));
        setPw(""); onClose(); toast("Password changed");
      }}>
        <Field label="New password" hint="At least 8 characters." htmlFor={pId}><input id={pId} className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {err && <p className="err" role="alert">{err}</p>}
        <Button type="submit" block loading={busy}>Save password</Button>
      </form>
    </Sheet>
  );
}

function DeleteAccount({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOut } = useSession();
  const [typed, setTyped] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  return (
    <Sheet open={open} onClose={onClose} title="Delete your account?">
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>This permanently deletes your account, your requests, photos and messages. Properties where you're the only manager are deleted too. This can't be undone.</p>
        <Field label="Type DELETE to confirm" htmlFor="del-confirm"><input id="del-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" /></Field>
        {err && <p className="err" role="alert">{err}</p>}
        <Button variant="danger" block loading={busy} disabled={typed.trim() !== "DELETE"} onClick={async () => {
          setBusy(true); setErr(null);
          const { data } = await supabase.auth.getSession();
          const r = await fetch("/api/delete-account", { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token || ""}` } }).catch(() => null);
          setBusy(false);
          if (!r || !r.ok) { const j = r ? await r.json().catch(() => ({})) : {}; return setErr(j.error || "Couldn't delete the account. Check your connection and try again."); }
          await signOut(); nav("/", { replace: true });
        }}>Delete account</Button>
      </div>
    </Sheet>
  );
}

export function Places() {
  const { places, memberships, refresh, setWorkspace } = useSession();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [sheet, setSheet] = useState<null | "join" | "external" | { edit: ExternalPlace } | { leave: Membership }>(params.get("join") ? "join" : null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  useEffect(() => { if (params.get("join")) setParams({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => setSheet(null);
  const done = async (msg: string, role: string = "resident") => { await refresh(); close(); toast(msg); setWorkspace(role === "manager" ? "manager" : "resident"); };
  return (
    <>
      <TopBar title="My homes" back={() => nav("/settings")} />
      <div className="page stack-lg">
        <Link to="/settings" className="btn ghost sm desktop-only" style={{ alignSelf: "flex-start", marginLeft: -8 }}><Icon name="chevronLeft" />Settings</Link>
        <div><h1 className="h1">My homes</h1><p className="lede">Report for any of these. If you rent in more than one place, add each one.</p></div>
        {places.length === 0 ? <Empty icon="home" title="No homes yet">Connect with your property's code, or add your landlord's contact details.</Empty> : (
          <div className="list">
            {places.map((p) => (
              <div key={p.key} className="list-row" style={{ cursor: "default" }}>
                <span className="avatar" style={{ borderRadius: 10 }}><Icon name={p.kind === "property" ? "building" : "home"} width={18} height={18} /></span>
                <div className="grow"><div style={{ fontWeight: 650 }}>{p.label}{p.unit ? ` · ${p.unit}` : ""}</div>
                  <div className="small muted">{p.kind === "property" ? "Requests go to the CanItWait inbox" : `Requests go by ${[p.place.contact_email && "email", p.place.contact_phone && "text"].filter(Boolean).join(" or ")}`}</div></div>
                {p.kind === "external"
                  ? <button className="btn ghost sm" onClick={() => setSheet({ edit: p.place })}>Edit</button>
                  : <button className="btn ghost sm" onClick={() => setSheet({ leave: p.membership })}>Leave</button>}
              </div>
            ))}
          </div>
        )}
        <div className="stack-sm">
          <Button block icon="key" onClick={() => setSheet("join")}>Join with a property code</Button>
          <Button block variant="secondary" icon="plus" onClick={() => setSheet("external")}>Add a home whose landlord isn't on CanItWait</Button>
        </div>
        {memberships.some((m) => m.role === "resident") && <p className="xs muted">Leaving a property stops new reports there. Requests you already sent stay in your list.</p>}
      </div>

      <Sheet open={sheet === "join"} onClose={close} title="Join with a code"><JoinForm onDone={(r) => done(r.role === "manager" ? `You now manage ${r.name}` : `Connected to ${r.name}`, r.role)} submitLabel="Connect" /></Sheet>
      <Sheet open={sheet === "external"} onClose={close} title="Add a home"><ExternalPlaceForm onDone={() => done("Home added")} /></Sheet>
      <Sheet open={!!sheet && typeof sheet === "object" && "edit" in sheet} onClose={close} title="Edit home">
        {sheet && typeof sheet === "object" && "edit" in sheet && (
          <ExternalPlaceForm initial={sheet.edit} onDone={() => done("Saved")} onDelete={async () => {
            const { error } = await supabase.from("external_places").delete().eq("id", sheet.edit.id);
            if (error) toast(friendly(error), "error"); else await done("Removed");
          }} />
        )}
      </Sheet>
      <Sheet open={!!sheet && typeof sheet === "object" && "leave" in sheet} onClose={close} title="Leave this property?">
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>You won't be able to report there until you join again with a code. Requests you already sent stay in your list.</p>
          <Button variant="danger" block loading={busy} onClick={async () => {
            if (!sheet || typeof sheet !== "object" || !("leave" in sheet)) return;
            setBusy(true);
            const { error } = await supabase.rpc("remove_membership", { p_membership: sheet.leave.id });
            setBusy(false);
            if (error) toast(friendly(error), "error"); else await done("You left the property");
          }}>Leave property</Button>
        </div>
      </Sheet>
    </>
  );
}
