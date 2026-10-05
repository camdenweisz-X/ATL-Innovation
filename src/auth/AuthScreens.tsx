import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase, friendly } from "../lib/supabase";
import { local } from "../lib/store";
import { useSession } from "../lib/session";
import { useT } from "../lib/i18n";
import { Button, Field, LangSwitch } from "../ui/kit";
import { Icon, GoogleMark } from "../ui/icons";

export function Brand() {
  return <Link to="/" className="brand"><span className="brand-mark"><Icon name="brand" /></span><span>Can<span className="brand-it">It</span>Wait</span></Link>;
}

/** Plain links (not router Links): these are static pages served outside the app. */
export function LegalLinks() {
  const { t } = useT();
  return <nav className="legal-links" aria-label={t("Legal")}><a href="/privacy">{t("Privacy")}</a><a href="/terms">{t("Terms")}</a></nav>;
}

/** Language picked before signing in is saved to the account at sign-in (see LangSync in App). */
const rememberPick = (l: "en" | "es") => local.set("cw_lang_pending", l);

function AuthFrame({ title, lede, children, foot }: { title: string; lede?: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-inner">
        <div className="between"><Brand /><LangSwitch compact onPick={rememberPick} /></div>
        <div className="auth-card stack-lg">
          <div>
            <h1 className="h1" style={{ fontSize: 26 }}>{title}</h1>
            {lede && <p className="lede">{lede}</p>}
          </div>
          {children}
        </div>
        {foot && <div className="center small muted">{foot}</div>}
        <LegalLinks />
      </div>
    </div>
  );
}

/** Signs in with Google, or creates the account. An existing account with the same verified email is the same account. */
function GoogleButton() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="stack-sm">
      <Button variant="secondary" block className="google-btn" loading={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/" } });
        if (error) { setBusy(false); setErr(/provider is not enabled/i.test(error.message) ? t("Google sign-in isn't set up yet. Use email for now.") : friendly(error)); }
      }}>{!busy && <GoogleMark />}{t("Continue with Google")}</Button>
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

function JoinNotice() {
  const { tx } = useT();
  const code = local.get<string | null>("fc_join", null);
  if (!code) return null;
  return <div className="notice info"><Icon name="key" /><div>{tx("You're joining with code {code}. We'll connect you after you sign in.", { code: <b className="mono">{code}</b> })}</div></div>;
}

export function Landing() {
  const { t } = useT();
  const params = new URLSearchParams(window.location.search + window.location.hash.replace(/^#/, "&"));
  const authError = params.get("error_description");
  return (
    <div className="auth">
      <header className="landing-hero between">
        <Brand />
        <div className="row"><LangSwitch compact onPick={rememberPick} /><Link to="/signin" className="btn ghost sm">{t("Sign in")}</Link></div>
      </header>
      <main className="landing-hero" style={{ paddingTop: 24, paddingBottom: 48 }}>
        {authError && <div className="notice warn" role="alert" style={{ marginBottom: 20 }}><Icon name="alert" /><div>{authError.replace(/\+/g, " ")}. {t("Try signing in, or request a new link.")}</div></div>}
        <div className="landing-grid">
          <div className="stack-lg">
            <div className="stack">
              <span className="eyebrow">{t("For renters and property managers")}</span>
              <h1 className="display">{t("Report what broke. Know how urgent it is.")}</h1>
              <p className="lede" style={{ fontSize: 18 }}>{t("Snap a photo and CanItWait tells you whether to call now or wait until morning, then writes a request maintenance can act on the first time.")}</p>
            </div>
            <div className="row-wrap">
              <Link to="/signup" className="btn">{t("Create a free account")}</Link>
              <Link to="/signin" className="btn secondary">{t("Sign in")}</Link>
            </div>
            <ul className="feature-list">
              <li><span className="fi"><Icon name="alert" /></span><div><b>{t("Clear urgency.")}</b> <span className="muted">{t("Emergency, urgent, or routine, with the reason and safe steps until it's fixed.")}</span></div></li>
              <li><span className="fi"><Icon name="bell" /></span><div><b>{t("Emergencies can't be missed.")}</b> <span className="muted">{t("Phone alerts for the team, and a backup contact if nobody answers.")}</span></div></li>
              <li><span className="fi"><Icon name="message" /></span><div><b>{t("English y español.")}</b> <span className="muted">{t("Use the app in your language. Requests and messages translate with one tap.")}</span></div></li>
              <li><span className="fi"><Icon name="inbox" /></span><div><b>{t("Managers see emergencies first.")}</b> <span className="muted">{t("An inbox sorted by urgency, with photos, unit, and entry permission.")}</span></div></li>
            </ul>
          </div>
          <figure className="preview desktop-only">
          <div className="preview-phone" aria-hidden="true">
            <div className="stack" style={{ padding: 6 }}>
              <div className="verdict Urgent"><span className="eyebrow">{t("AI urgency check")}</span><div className="lvl"><Icon name="clock" />{t("Urgent")}</div><div className="when">{t("It can wait until morning, so you can go to bed.")}</div><div className="small muted">{t("A slow leak you can catch with a bucket can wait, but should be fixed first thing.")}</div></div>
              <div className="card pad stack-sm"><div className="h3">{t("Until it's fixed")}</div><div className="small">• {t("Put a bucket or towels under the drip.")}</div><div className="small">• {t("Keep the bathroom light off if water is near it.")}</div></div>
              <div className="btn block preview-btn">{t("Send to {place}", { place: "Peachtree Commons" })}</div>
            </div>
          </div>
          <figcaption className="preview-cap">{t("Example of a result. Sign up to check your own.")}</figcaption>
          </figure>
        </div>
      </main>
      <footer className="landing-hero landing-foot"><span>© 2026 The InnovAItors</span><LegalLinks /></footer>
    </div>
  );
}

/** Only same-site paths, so a crafted link can't send people elsewhere after sign-in. */
function safeFrom(state: unknown): string {
  const f = (state as { from?: string } | null)?.from;
  return typeof f === "string" && f.startsWith("/") && !f.startsWith("//") ? f : "/";
}

export function SignIn() {
  const { t } = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState((loc.state as { email?: string } | null)?.email || "");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [wrongPw, setWrongPw] = useState(false);
  const eId = useId(), pId = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setWrongPw(false);
    if (!email || !pw) return setErr(t("Enter your email and password."));
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) { setWrongPw(/Invalid login credentials/i.test(error.message)); return setErr(friendly(error)); }
    nav(safeFrom(loc.state), { replace: true });
  };
  return (
    <AuthFrame title={t("Sign in")} foot={<>{t("New to CanItWait?")} <Link to="/signup">{t("Create an account")}</Link></>}>
      <JoinNotice />
      <GoogleButton />
      <div className="divider">{t("or")}</div>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label={t("Email")} htmlFor={eId}><input id={eId} className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t("Password")} htmlFor={pId}><input id={pId} className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {err && <p className="err" role="alert"><Icon name="alert" width={16} height={16} />{err}</p>}
        {wrongPw && <p className="hint" style={{ margin: 0 }}>{t("Created your account with Google? Use Continue with Google above. Otherwise reset your password below.")}</p>}
        <Button type="submit" block loading={busy}>{t("Sign in")}</Button>
        <Link to="/forgot" state={{ email }} className="small center">{t("Forgot your password?")}</Link>
      </form>
    </AuthFrame>
  );
}

export function SignUp() {
  const { t, tx, lang } = useT();
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);
  const [exists, setExists] = useState(false);
  const nav = useNavigate();
  const nId = useId(), eId = useId(), pId = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setExists(false);
    const addr = email.trim();
    if (!name.trim()) return setErr(t("Add your name so your manager knows who sent the request."));
    if (!/^\S+@\S+\.\S+$/.test(addr)) return setErr(t("Enter a valid email address."));
    if (pw.length < 8) return setErr(t("Use a password with at least 8 characters."));
    setBusy(true);
    // Already have an account with this email and password? Then this is just a sign-in.
    const tryIn = await supabase.auth.signInWithPassword({ email: addr, password: pw });
    if (!tryIn.error) { setBusy(false); return nav("/", { replace: true }); }
    if (/Email not confirmed/i.test(tryIn.error.message)) {
      setBusy(false);
      return setErr(t("You already started an account with this email. Open the confirmation link we emailed you, then sign in."));
    }
    const { data, error } = await supabase.auth.signUp({
      email: addr, password: pw,
      options: { data: { full_name: name.trim(), lang }, emailRedirectTo: window.location.origin + "/" },
    });
    setBusy(false);
    // Supabase reports an existing email either as an error or, when email confirmation is on, as a user with no identities.
    if (error) return /already registered|already been registered|exists/i.test(error.message) ? setExists(true) : setErr(friendly(error));
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return setExists(true);
    if (data.session) nav("/", { replace: true }); else setSent(true);
  };
  if (sent) return (
    <AuthFrame title={t("Check your email")} lede={t("We sent a confirmation link to {email}. Open it in this browser to finish creating your account.", { email })}
      foot={<Link to="/signin">{t("Back to sign in")}</Link>}>
      <div className="notice info"><Icon name="mail" /><div>{t("Didn't get it? Check spam, or wait a minute and try signing in.")}</div></div>
    </AuthFrame>
  );
  return (
    <AuthFrame title={t("Create your account")} lede={t("Free for renters and property managers.")} foot={<>{t("Already have an account?")} <Link to="/signin">{t("Sign in")}</Link></>}>
      <JoinNotice />
      <GoogleButton />
      <div className="divider">{t("or")}</div>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label={t("Full name")} htmlFor={nId}><input id={nId} className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("Email")} htmlFor={eId}><input id={eId} className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setExists(false); }} /></Field>
        <Field label={t("Password")} hint={t("At least 8 characters.")} htmlFor={pId}><input id={pId} className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {exists && (
          <div className="notice warn" role="alert"><Icon name="user" /><div className="stack-sm" style={{ gap: 8 }}>
            <div><b>{t("You already have an account with {email}.", { email: email.trim() })}</b> {t("Sign in with your password, or use Continue with Google if that's how you created it.")}</div>
            <div className="row-wrap">
              <Link to="/signin" state={{ email: email.trim() }} className="btn sm">{t("Sign in")}</Link>
              <Link to="/forgot" state={{ email: email.trim() }} className="btn secondary sm">{t("Reset password")}</Link>
            </div>
          </div></div>
        )}
        {err && <p className="err" role="alert"><Icon name="alert" width={16} height={16} />{err}</p>}
        <Button type="submit" block loading={busy}>{t("Create account")}</Button>
        <p className="xs muted center" style={{ margin: 0 }}>{tx("By creating an account you agree to the {terms} and {privacy}. CanItWait uses AI to suggest urgency, so don't put sensitive personal details in reports.", { terms: <a href="/terms">{t("Terms")}</a>, privacy: <a href="/privacy">{t("Privacy Policy")}</a> })}</p>
      </form>
    </AuthFrame>
  );
}

export function Forgot() {
  const { t } = useT();
  const loc = useLocation();
  const [email, setEmail] = useState((loc.state as { email?: string } | null)?.email || "");
  const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const eId = useId();
  return (
    <AuthFrame title={t("Reset your password")} lede={sent ? t("If {email} has an account, a reset link is on its way.", { email }) : t("We'll email you a link to set a new password.")}
      foot={<Link to="/signin">{t("Back to sign in")}</Link>}>
      {!sent && (
        <form className="stack" noValidate onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr(t("Enter a valid email address."));
          setBusy(true);
          const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + "/reset" });
          setBusy(false);
          if (error) setErr(friendly(error)); else setSent(true);
        }}>
          <Field label={t("Email")} htmlFor={eId}><input id={eId} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {err && <p className="err" role="alert">{err}</p>}
          <Button type="submit" block loading={busy}>{t("Send reset link")}</Button>
        </form>
      )}
    </AuthFrame>
  );
}

export function ResetPassword() {
  const { t } = useT();
  const { session } = useSession();
  const nav = useNavigate();
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const pId = useId(), p2Id = useId();
  if (done) return (
    <AuthFrame title={t("Password updated")} lede={t("Your new password is saved. Use it next time you sign in.")}><Button block onClick={() => nav("/", { replace: true })}>{t("Continue")}</Button></AuthFrame>
  );
  if (!session) return (
    <AuthFrame title={t("Link expired")} lede={t("This reset link is no longer valid. Request a new one.")} foot={<Link to="/forgot">{t("Send a new link")}</Link>}><span /></AuthFrame>
  );
  return (
    <AuthFrame title={t("Set a new password")} lede={session.user.email ? t("For {email}", { email: session.user.email }) : undefined}>
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        if (pw.length < 8) return setErr(t("Use a password with at least 8 characters."));
        if (pw !== pw2) return setErr(t("The passwords don't match."));
        setBusy(true);
        const { error } = await supabase.auth.updateUser({ password: pw });
        setBusy(false);
        if (error) setErr(/should be different/i.test(error.message) ? t("Choose a password different from your old one.") : friendly(error)); else setDone(true);
      }}>
        <Field label={t("New password")} hint={t("At least 8 characters.")} htmlFor={pId}><input id={pId} className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label={t("Confirm new password")} htmlFor={p2Id}><input id={p2Id} className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        {err && <p className="err" role="alert">{err}</p>}
        <Button type="submit" block loading={busy}>{t("Save password")}</Button>
      </form>
    </AuthFrame>
  );
}

/** /join/:code — remembers the code, then sends people to sign up or to add the place. */
export function JoinLink() {
  const { code } = useParams();
  const { session, profile } = useSession();
  const nav = useNavigate();
  useEffect(() => {
    if (code) local.set("fc_join", code.toUpperCase());
    if (!session) nav("/signup", { replace: true });
    else if (!profile?.onboarded) nav("/onboarding", { replace: true });
    else nav("/settings/places?join=1", { replace: true });
  }, [code, session, profile, nav]);
  return null;
}

export function SetupNeeded() {
  const { t, tx } = useT();
  return (
    <AuthFrame title={t("CanItWait isn't connected yet")} lede={t("This deployment is missing its Supabase settings.")}>
      <div className="notice warn"><Icon name="info" /><div className="small">{tx("Add {a} and {b} in Vercel → Settings → Environment Variables, then redeploy. See SETUP.md in the repo.", { a: <span className="mono">VITE_SUPABASE_URL</span>, b: <span className="mono">VITE_SUPABASE_ANON_KEY</span> })}</div></div>
    </AuthFrame>
  );
}
