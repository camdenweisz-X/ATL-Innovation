import { useEffect, useId, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase, friendly } from "../lib/supabase";
import { useSession } from "../lib/session";
import { getTheme, setTheme } from "../lib/theme";
import { useT } from "../lib/i18n";
import { pushState, enablePush, disablePush, type PushState } from "../lib/push";
import type { User } from "@supabase/supabase-js";
import type { ExternalPlace, Membership } from "../lib/types";
import { Button, Field, Sheet, Switch, useToast, Empty, LangSwitch } from "../ui/kit";
import { Icon, GoogleMark } from "../ui/icons";
import { TopBar } from "../AppShell";
import { ExternalPlaceForm, JoinForm, CreatePropertyForm } from "../shared-screens/PlaceForms";

const APP_VERSION = "2.2";

/** Which ways this account can sign in. Accounts created with Google have no password until they set one. */
function signInMethods(user: User | null) {
  const providers = new Set<string>([
    ...((user?.app_metadata?.providers as string[] | undefined) || []),
    ...(user?.identities || []).map((i) => i.provider),
  ]);
  return { google: providers.has("google"), password: providers.has("email") };
}

export function Settings() {
  const { profile, user, refresh, signOut, places, managed, workspace, setWorkspace } = useSession();
  const { t } = useT();
  const toast = useToast();
  const nav = useNavigate();
  const [name, setName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [saving, setSaving] = useState(false);
  const [dark, setDark] = useState(getTheme() === "dark");
  const [sheet, setSheet] = useState<null | "email" | "password" | "delete" | "signout-all" | "manager">(null);
  const ids = { n: useId(), p: useId() };
  const dirty = name !== (profile?.full_name || "") || phone !== (profile?.phone || "");
  const methods = signInMethods(user);
  const pendingEmail = user?.new_email && user.new_email !== user.email ? user.new_email : null;
  const close = () => setSheet(null);

  // Keep the form in step with the saved profile (for example after it loads).
  useEffect(() => { setName(profile?.full_name || ""); setPhone(profile?.phone || ""); }, [profile?.full_name, profile?.phone]);

  return (
    <>
      <TopBar title={t("Settings")} />
      <div className="page stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}><h1 className="h1">{t("Settings")}</h1></div>

        <section className="stack-sm">
          <h2 className="section-title">{t("Language")}</h2>
          <LangSwitch onPick={async (l) => {
            if (!user) return;
            const { error } = await supabase.from("profiles").update({ lang: l }).eq("id", user.id);
            if (error) toast(friendly(error), "error"); else await refresh();
          }} />
          <p className="hint" style={{ margin: "0 4px" }}>{t("The app, AI results, emails and notifications use this language. Requests and messages in another language can be translated with one tap.")}</p>
        </section>

        {places.length > 0 && managed.length > 0 && (
          <section className="stack-sm">
            <h2 className="section-title">{t("Workspace")}</h2>
            <div className="seg" role="group" aria-label={t("Workspace")}>
              <button aria-pressed={workspace === "resident"} onClick={() => { setWorkspace("resident"); nav("/r"); }}>{t("Resident")}</button>
              <button aria-pressed={workspace === "manager"} onClick={() => { setWorkspace("manager"); nav("/m"); }}>{t("Manager")}</button>
            </div>
          </section>
        )}

        <section className="stack-sm">
          <h2 className="section-title">{t("Profile")}</h2>
          <form className="card pad stack" noValidate onSubmit={async (e) => {
            e.preventDefault();
            if (!dirty || !name.trim()) return;
            setSaving(true);
            const { error } = await supabase.from("profiles").update({ full_name: name.trim(), phone: phone.trim() || null }).eq("id", user!.id);
            setSaving(false);
            if (error) return toast(friendly(error), "error");
            await refresh(); toast(t("Profile saved"));
          }}>
            <Field label={t("Full name")} htmlFor={ids.n}><input id={ids.n} className="input" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t("Mobile number")} optional hint={t("Shared with managers of properties you join. If you manage properties, your residents see it too.")} htmlFor={ids.p}><input id={ids.p} className="input" type="tel" autoComplete="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <div className="row-wrap">
              <Button type="submit" size="sm" disabled={!dirty || !name.trim()} loading={saving}>{t("Save changes")}</Button>
              {dirty && <Button type="button" size="sm" variant="ghost" onClick={() => { setName(profile?.full_name || ""); setPhone(profile?.phone || ""); }}>{t("Cancel")}</Button>}
            </div>
          </form>
        </section>

        <section className="stack-sm">
          <h2 className="section-title">{t("Sign-in and security")}</h2>
          <div className="list">
            <div className="list-row" style={{ cursor: "default" }}>
              <Icon name="mail" width={20} height={20} />
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{t("Email")}</div>
                <div className="small muted break">{user?.email}</div>
                {pendingEmail && <div className="small pending-note">{t("Waiting for you to confirm {email}", { email: pendingEmail })}</div>}
              </div>
              <button className="btn ghost sm" onClick={() => setSheet("email")}>{t("Change")}</button>
            </div>
            <div className="list-row" style={{ cursor: "default" }}>
              <Icon name="key" width={20} height={20} />
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{t("Password")}</div>
                <div className="small muted">{methods.password ? t("Used to sign in with your email") : t("Not set. You sign in with Google.")}</div>
              </div>
              <button className="btn ghost sm" onClick={() => setSheet("password")}>{methods.password ? t("Change") : t("Set")}</button>
            </div>
            {methods.google && (
              <div className="list-row" style={{ cursor: "default" }}>
                <GoogleMark />
                <div className="grow"><div style={{ fontWeight: 600 }}>Google</div><div className="small muted">{t("Connected. You can sign in with Google.")}</div></div>
              </div>
            )}
            <button className="list-row" onClick={() => setSheet("signout-all")}>
              <Icon name="shield" width={20} height={20} />
              <div className="grow"><div style={{ fontWeight: 600 }}>{t("Sign out everywhere")}</div><div className="small muted">{t("Sign out on every phone and computer, including this one.")}</div></div>
              <Icon name="chevronRight" />
            </button>
          </div>
        </section>

        <section className="stack-sm">
          <h2 className="section-title">{t("Homes and properties")}</h2>
          <div className="list">
            <Link to="/settings/places" className="list-row"><Icon name="home" width={20} height={20} /><div className="grow"><div style={{ fontWeight: 600 }}>{t("My homes")}</div><div className="small muted">{places.length ? places.map((p) => p.label).join(", ") : t("Add a home to report problems")}</div></div><Icon name="chevronRight" /></Link>
            {managed.length > 0 ? (
              <Link to="/m/properties" className="list-row" onClick={() => setWorkspace("manager")}><Icon name="building" width={20} height={20} /><div className="grow"><div style={{ fontWeight: 600 }}>{t("Properties I manage")}</div><div className="small muted">{managed.map((p) => p.name).join(", ")}</div></div><Icon name="chevronRight" /></Link>
            ) : (
              <button className="list-row" onClick={() => setSheet("manager")}><Icon name="building" width={20} height={20} /><div className="grow"><div style={{ fontWeight: 600 }}>{t("Manage a property")}</div><div className="small muted">{t("Add a property or join a team as a co-manager")}</div></div><Icon name="chevronRight" /></button>
            )}
          </div>
        </section>

        <section className="stack-sm">
          <h2 className="section-title">{t("Notifications")}</h2>
          <div className="list">
            <PushRow />
            <div className="list-row" style={{ cursor: "default" }}>
              <Icon name="mail" width={20} height={20} />
              <div className="grow"><div style={{ fontWeight: 600 }}>{t("Email updates")}</div><div className="small muted">{t("New requests, status changes and messages, sent to {email}.", { email: user?.email })}</div></div>
              <Switch label={t("Email updates")} checked={profile?.notify_email ?? true} onChange={async (v) => {
                const { error } = await supabase.from("profiles").update({ notify_email: v }).eq("id", user!.id);
                if (error) toast(friendly(error), "error"); else { await refresh(); toast(v ? t("Email updates on") : t("Email updates off")); }
              }} />
            </div>
            {managed.length > 0 && (
              <div className="list-row" style={{ cursor: "default" }}>
                <Icon name="phone" width={20} height={20} />
                <div className="grow"><div style={{ fontWeight: 600 }}>{t("Emergency texts")}</div>
                  <div className="small muted">{profile?.phone ? t("Emergencies at your properties are texted to {phone}, when texting is set up for CanItWait.", { phone: profile.phone }) : t("Add your mobile number above to get emergencies by text.")}</div></div>
                <Switch label={t("Emergency texts")} checked={(profile?.notify_sms ?? true) && !!profile?.phone} onChange={async (v) => {
                  if (v && !profile?.phone) return toast(t("Add your mobile number first."), "error");
                  const { error } = await supabase.from("profiles").update({ notify_sms: v }).eq("id", user!.id);
                  if (error) toast(friendly(error), "error"); else { await refresh(); toast(v ? t("Emergency texts on") : t("Emergency texts off")); }
                }} />
              </div>
            )}
          </div>
        </section>

        <section className="stack-sm">
          <h2 className="section-title">{t("Appearance")}</h2>
          <div className="list">
            <div className="list-row" style={{ cursor: "default" }}>
              <Icon name="sun" width={20} height={20} />
              <div className="grow"><div style={{ fontWeight: 600 }}>{t("Dark mode")}</div><div className="small muted">{t("Easier on the eyes at night. Saved on this device.")}</div></div>
              <Switch label={t("Dark mode")} checked={dark} onChange={(v) => { setTheme(v ? "dark" : "light"); setDark(v); }} />
            </div>
          </div>
        </section>

        <section className="stack-sm">
          <h2 className="section-title">{t("Privacy")}</h2>
          <div className="card pad small muted stack-sm">
            <p style={{ margin: 0 }}>{t("Photos and descriptions are sent to Google's Gemini AI to suggest urgency and to translate when you ask. On the free tier Google may use them to improve its products, so don't include sensitive personal details.")}</p>
            <p style={{ margin: 0 }}>{t("Your requests, photos and videos are visible only to you and the managers of the property you sent them to.")}</p>
          </div>
          <div className="list">
            <a href="/privacy" className="list-row"><Icon name="lock" width={20} height={20} /><div className="grow" style={{ fontWeight: 600 }}>{t("Privacy Policy")}</div><Icon name="chevronRight" /></a>
            <a href="/terms" className="list-row"><Icon name="info" width={20} height={20} /><div className="grow" style={{ fontWeight: 600 }}>{t("Terms of Service")}</div><Icon name="chevronRight" /></a>
            <a href="mailto:camdenweisz@gmail.com?subject=CanItWait%20help" className="list-row"><Icon name="message" width={20} height={20} /><div className="grow"><div style={{ fontWeight: 600 }}>{t("Contact support")}</div><div className="small muted">camdenweisz@gmail.com</div></div><Icon name="chevronRight" /></a>
          </div>
        </section>

        <div className="stack-sm">
          <Button variant="secondary" block icon="logout" onClick={async () => { await signOut(); nav("/", { replace: true }); }}>{t("Sign out")}</Button>
          <Button variant="danger-outline" block icon="trash" onClick={() => setSheet("delete")}>{t("Delete account")}</Button>
          <p className="xs muted center">CanItWait {APP_VERSION} · The InnovAItors</p>
        </div>
      </div>

      <ChangeEmail open={sheet === "email"} onClose={close} />
      <ChangePassword open={sheet === "password"} onClose={close} hasPassword={methods.password} />
      <SignOutEverywhere open={sheet === "signout-all"} onClose={close} />
      <DeleteAccount open={sheet === "delete"} onClose={close} />
      <Sheet open={sheet === "manager"} onClose={close} title={t("Manage a property")}>
        <div className="stack">
          <CreatePropertyForm onDone={async (id) => { await refresh(); setWorkspace("manager"); close(); nav(`/m/properties/${id}`); }} />
          <div className="divider">{t("or join a team")}</div>
          <JoinForm initialCode="" onDone={async () => { await refresh(); setWorkspace("manager"); close(); nav("/m"); }} />
        </div>
      </Sheet>
    </>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ChangeEmail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, refresh } = useSession();
  const { t, tx } = useT();
  const toast = useToast(); const eId = useId();
  const [email, setEmail] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [sentTo, setSentTo] = useState<string | null>(null);
  const finish = () => { setEmail(""); setErr(null); setSentTo(null); onClose(); };
  return (
    <Sheet open={open} onClose={finish} title={t("Change email")}>
      {sentTo ? (
        <div className="stack">
          <div className="notice info"><Icon name="mail" /><div>{tx("We sent a confirmation link to {email}. Your email changes after you open it. If you also get a link at your current address, open that one too.", { email: <b className="break">{sentTo}</b> })}</div></div>
          <p className="small muted" style={{ margin: 0 }}>{t("Until then, keep signing in with {email}.", { email: user?.email })}</p>
          <Button block onClick={finish}>{t("Done")}</Button>
        </div>
      ) : (
        <form className="stack" noValidate onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          const next = email.trim().toLowerCase();
          if (!EMAIL_RE.test(next)) return setErr(t("Enter a valid email address."));
          if (next === (user?.email || "").toLowerCase()) return setErr(t("That's already your email."));
          setBusy(true);
          const { data, error } = await supabase.auth.updateUser({ email: next }, { emailRedirectTo: window.location.origin + "/settings" });
          setBusy(false);
          if (error) return setErr(/already been registered|already registered|exists/i.test(error.message) ? t("Another account already uses that email.") : friendly(error));
          if ((data.user?.email || "").toLowerCase() === next) { await refresh(); toast(t("Email changed")); finish(); }
          else setSentTo(next);
        }}>
          <p className="small muted" style={{ margin: 0 }}>{t("Current email:")} <span className="break">{user?.email}</span></p>
          <Field label={t("New email")} htmlFor={eId}><input id={eId} className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {err && <p className="err" role="alert">{err}</p>}
          <Button type="submit" block loading={busy}>{t("Change email")}</Button>
        </form>
      )}
    </Sheet>
  );
}

function ChangePassword({ open, onClose, hasPassword }: { open: boolean; onClose: () => void; hasPassword: boolean }) {
  const { user } = useSession();
  const [cur, setCur] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [sending, setSending] = useState(false);
  const { t } = useT();
  const toast = useToast(); const cId = useId(), pId = useId(), p2Id = useId();
  const finish = () => { setCur(""); setPw(""); setPw2(""); setErr(null); onClose(); };
  return (
    <Sheet open={open} onClose={finish} title={hasPassword ? t("Change password") : t("Set a password")}>
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        if (hasPassword && !cur) return setErr(t("Enter your current password."));
        if (pw.length < 8) return setErr(t("Use at least 8 characters for the new password."));
        if (pw !== pw2) return setErr(t("The new passwords don't match."));
        if (hasPassword && pw === cur) return setErr(t("Choose a password different from your current one."));
        setBusy(true);
        if (hasPassword) {
          // Confirm the current password first, so someone using an unlocked phone can't change it.
          const { error: e1 } = await supabase.auth.signInWithPassword({ email: user!.email!, password: cur });
          if (e1) { setBusy(false); return setErr(/Invalid login credentials/i.test(e1.message) ? t("Your current password isn't right.") : friendly(e1)); }
        }
        const { error } = await supabase.auth.updateUser({ password: pw });
        setBusy(false);
        if (error) return setErr(/should be different/i.test(error.message) ? t("Choose a password different from your current one.") : friendly(error));
        toast(hasPassword ? t("Password changed") : t("Password set. You can now sign in with your email too."));
        finish();
      }}>
        {!hasPassword && <p className="small muted" style={{ margin: 0 }}>{t("Add a password so you can also sign in with {email} and a password.", { email: user?.email })}</p>}
        {hasPassword && <Field label={t("Current password")} htmlFor={cId}><input id={cId} className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>}
        <Field label={t("New password")} hint={t("At least 8 characters.")} htmlFor={pId}><input id={pId} className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label={t("Confirm new password")} htmlFor={p2Id}><input id={p2Id} className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        {err && <p className="err" role="alert">{err}</p>}
        <Button type="submit" block loading={busy}>{hasPassword ? t("Change password") : t("Set password")}</Button>
        {hasPassword && (
          <Button type="button" variant="ghost" block loading={sending} onClick={async () => {
            setSending(true); setErr(null);
            const { error } = await supabase.auth.resetPasswordForEmail(user!.email!, { redirectTo: window.location.origin + "/reset" });
            setSending(false);
            if (error) return setErr(friendly(error));
            toast(t("Reset link sent to {email}", { email: user!.email })); finish();
          }}>{t("Forgot it? Email me a reset link")}</Button>
        )}
      </form>
    </Sheet>
  );
}

function SignOutEverywhere({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOut } = useSession();
  const nav = useNavigate(); const toast = useToast();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={t("Sign out everywhere?")}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t("You'll be signed out on every phone and computer, including this one. Use this if you lost a device or think someone else signed in.")}</p>
        <Button block loading={busy} onClick={async () => {
          setBusy(true);
          const { error } = await supabase.auth.signOut({ scope: "global" });
          setBusy(false);
          if (error) return toast(friendly(error), "error");
          await signOut(); nav("/", { replace: true });
        }}>{t("Sign out everywhere")}</Button>
      </div>
    </Sheet>
  );
}

function DeleteAccount({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOut } = useSession();
  const [typed, setTyped] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  const { t } = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t("Delete your account?")}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t("This permanently deletes your account, your requests, photos, videos and messages. Properties where you're the only manager are deleted too. This can't be undone.")}</p>
        <Field label={t("Type DELETE to confirm")} htmlFor="del-confirm"><input id="del-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" /></Field>
        {err && <p className="err" role="alert">{err}</p>}
        <Button variant="danger" block loading={busy} disabled={typed.trim() !== "DELETE"} onClick={async () => {
          setBusy(true); setErr(null);
          const { data } = await supabase.auth.getSession();
          const r = await fetch("/api/delete-account", { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token || ""}` } }).catch(() => null);
          setBusy(false);
          if (!r || !r.ok) { const j = r ? await r.json().catch(() => ({})) : {}; return setErr(j.error || t("Couldn't delete the account. Check your connection and try again.")); }
          await signOut(); nav("/", { replace: true });
        }}>{t("Delete account")}</Button>
      </div>
    </Sheet>
  );
}

export function Places() {
  const { places, memberships, refresh, setWorkspace } = useSession();
  const { t } = useT();
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
      <TopBar title={t("My homes")} back={() => nav("/settings")} />
      <div className="page stack-lg">
        <Link to="/settings" className="btn ghost sm desktop-only" style={{ alignSelf: "flex-start", marginLeft: -8 }}><Icon name="chevronLeft" />{t("Settings")}</Link>
        <div><h1 className="h1">{t("My homes")}</h1><p className="lede">{t("Report for any of these. If you rent in more than one place, add each one.")}</p></div>
        {places.length === 0 ? <Empty icon="home" title={t("No homes yet")}>{t("Connect with your property's code, or add your landlord's contact details.")}</Empty> : (
          <div className="list">
            {places.map((p) => (
              <div key={p.key} className="list-row" style={{ cursor: "default" }}>
                <span className="avatar" style={{ borderRadius: 10 }}><Icon name={p.kind === "property" ? "building" : "home"} width={18} height={18} /></span>
                <div className="grow"><div style={{ fontWeight: 650 }}>{p.label}{p.unit ? ` · ${p.unit}` : ""}</div>
                  <div className="small muted">{p.kind === "property" ? t("Requests go to the CanItWait inbox") : p.place.contact_email && p.place.contact_phone ? t("Requests go by email or text") : p.place.contact_email ? t("Requests go by email") : t("Requests go by text")}</div></div>
                {p.kind === "external"
                  ? <button className="btn ghost sm" onClick={() => setSheet({ edit: p.place })}>{t("Edit")}</button>
                  : <button className="btn ghost sm" onClick={() => setSheet({ leave: p.membership })}>{t("Leave")}</button>}
              </div>
            ))}
          </div>
        )}
        <div className="stack-sm">
          <Button block icon="key" onClick={() => setSheet("join")}>{t("Join with a property code")}</Button>
          <Button block variant="secondary" icon="plus" onClick={() => setSheet("external")}>{t("Add a home whose landlord isn't on CanItWait")}</Button>
        </div>
        {memberships.some((m) => m.role === "resident") && <p className="xs muted">{t("Leaving a property stops new reports there. Requests you already sent stay in your list.")}</p>}
      </div>

      <Sheet open={sheet === "join"} onClose={close} title={t("Join with a code")}><JoinForm onDone={(r) => done(r.role === "manager" ? t("You now manage {place}", { place: r.name }) : t("Connected to {place}", { place: r.name }), r.role)} submitLabel={t("Connect")} /></Sheet>
      <Sheet open={sheet === "external"} onClose={close} title={t("Add a home")}><ExternalPlaceForm onDone={() => done(t("Home added"))} /></Sheet>
      <Sheet open={!!sheet && typeof sheet === "object" && "edit" in sheet} onClose={close} title={t("Edit home")}>
        {sheet && typeof sheet === "object" && "edit" in sheet && (
          <ExternalPlaceForm initial={sheet.edit} onDone={() => done(t("Saved"))} onDelete={async () => {
            const { error } = await supabase.from("external_places").delete().eq("id", sheet.edit.id);
            if (error) toast(friendly(error), "error"); else await done(t("Removed"));
          }} />
        )}
      </Sheet>
      <Sheet open={!!sheet && typeof sheet === "object" && "leave" in sheet} onClose={close} title={t("Leave this property?")}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>{t("You won't be able to report there until you join again with a code. Requests you already sent stay in your list.")}</p>
          <Button variant="danger" block loading={busy} onClick={async () => {
            if (!sheet || typeof sheet !== "object" || !("leave" in sheet)) return;
            setBusy(true);
            const { error } = await supabase.rpc("remove_membership", { p_membership: sheet.leave.id });
            setBusy(false);
            if (error) toast(friendly(error), "error"); else await done(t("You left the property"));
          }}>{t("Leave property")}</Button>
        </div>
      </Sheet>
    </>
  );
}

/** Phone/browser notifications for this device. Emergencies stay on screen until tapped. */
function PushRow() {
  const { t } = useT();
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushState().then(setState).catch(() => setState("unsupported")); }, []);
  if (!state || state === "unconfigured") return null;
  const sub = state === "needs-install" ? t("On iPhone, first tap Share, then Add to Home Screen, and open CanItWait from there.")
    : state === "unsupported" ? t("This browser can't show notifications. Try Chrome, Edge, Firefox or Safari.")
    : state === "denied" ? t("Notifications are blocked for CanItWait in this browser's settings.")
    : t("Emergencies, new requests, status changes and messages on this device.");
  return (
    <div className="list-row" style={{ cursor: "default" }}>
      <Icon name="bell" width={20} height={20} />
      <div className="grow"><div style={{ fontWeight: 600 }}>{t("Phone notifications")}</div><div className="small muted">{sub}</div></div>
      {(state === "on" || state === "off") && (
        <Switch label={t("Phone notifications")} checked={state === "on"} onChange={async (v) => {
          if (busy) return;
          setBusy(true);
          try {
            const s = v ? await enablePush() : await disablePush();
            setState(s);
            toast(s === "on" ? t("Notifications on for this device") : s === "denied" ? t("Notifications are blocked for CanItWait in this browser's settings.") : t("Notifications off for this device"), s === "denied" ? "error" : "ok");
          } catch (e) { toast(friendly(e), "error"); } finally { setBusy(false); }
        }} />
      )}
    </div>
  );
}
