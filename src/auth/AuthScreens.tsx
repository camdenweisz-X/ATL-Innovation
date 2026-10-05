import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase, friendly } from "../lib/supabase";
import { local } from "../lib/store";
import { useSession } from "../lib/session";
import { Button, Field } from "../ui/kit";
import { Icon, GoogleMark } from "../ui/icons";

export function Brand() {
  return <Link to="/" className="brand"><span className="brand-mark"><Icon name="brand" /></span><span>Can<span className="brand-it">It</span>Wait</span></Link>;
}

/** Plain links (not router Links): these are static pages served outside the app. */
export function LegalLinks() {
  return <nav className="legal-links" aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>;
}

function AuthFrame({ title, lede, children, foot }: { title: string; lede?: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-inner">
        <Brand />
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

function GoogleButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="stack-sm">
      <Button variant="secondary" block className="google-btn" loading={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/" } });
        if (error) { setBusy(false); setErr(/provider is not enabled/i.test(error.message) ? "Google sign-in isn't set up yet. Use email for now." : friendly(error)); }
      }}>{!busy && <GoogleMark />}Continue with Google</Button>
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

function JoinNotice() {
  const code = local.get<string | null>("fc_join", null);
  if (!code) return null;
  return <div className="notice info"><Icon name="key" /><div>You're joining with code <b className="mono">{code}</b>. We'll connect you after you sign in.</div></div>;
}

export function Landing() {
  const params = new URLSearchParams(window.location.search + window.location.hash.replace(/^#/, "&"));
  const authError = params.get("error_description");
  return (
    <div className="auth">
      <header className="landing-hero between">
        <Brand />
        <div className="row"><Link to="/signin" className="btn ghost sm">Sign in</Link></div>
      </header>
      <main className="landing-hero" style={{ paddingTop: 24, paddingBottom: 48 }}>
        {authError && <div className="notice warn" role="alert" style={{ marginBottom: 20 }}><Icon name="alert" /><div>{authError.replace(/\+/g, " ")}. Try signing in, or request a new link.</div></div>}
        <div className="landing-grid">
          <div className="stack-lg">
            <div className="stack">
              <span className="eyebrow">For renters and property managers</span>
              <h1 className="display">Report what broke. Know how urgent it is.</h1>
              <p className="lede" style={{ fontSize: 18 }}>Snap a photo and CanItWait tells you whether to call now or wait until morning, then writes a request maintenance can act on the first time.</p>
            </div>
            <div className="row-wrap">
              <Link to="/signup" className="btn">Create a free account</Link>
              <Link to="/signin" className="btn secondary">Sign in</Link>
            </div>
            <ul className="feature-list">
              <li><span className="fi"><Icon name="alert" /></span><div><b>Clear urgency.</b> <span className="muted">Emergency, urgent, or routine, with the reason and safe steps until it's fixed.</span></div></li>
              <li><span className="fi"><Icon name="message" /></span><div><b>One thread per request.</b> <span className="muted">Status updates and messages with your manager in one place.</span></div></li>
              <li><span className="fi"><Icon name="inbox" /></span><div><b>Managers see emergencies first.</b> <span className="muted">An inbox sorted by urgency, with photos, unit, and entry permission.</span></div></li>
            </ul>
          </div>
          <div className="preview-phone desktop-only" aria-hidden="true">
            <div className="stack" style={{ padding: 6 }}>
              <div className="verdict Urgent"><span className="eyebrow">AI urgency check</span><div className="lvl"><Icon name="clock" />Urgent</div><div className="when">It can wait until morning, so you can go to bed.</div><div className="small muted">A slow leak you can catch with a bucket can wait, but should be fixed first thing.</div></div>
              <div className="card pad stack-sm"><div className="h3">Until it's fixed</div><div className="small">• Put a bucket or towels under the drip.</div><div className="small">• Keep the bathroom light off if water is near it.</div></div>
              <div className="btn block">Send to Peachtree Commons</div>
            </div>
          </div>
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
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const eId = useId(), pId = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!email || !pw) return setErr("Enter your email and password.");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) return setErr(friendly(error));
    nav(safeFrom(loc.state), { replace: true });
  };
  return (
    <AuthFrame title="Sign in" foot={<>New to CanItWait? <Link to="/signup">Create an account</Link></>}>
      <JoinNotice />
      <GoogleButton />
      <div className="divider">or</div>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Email" htmlFor={eId}><input id={eId} className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor={pId}><input id={pId} className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {err && <p className="err" role="alert"><Icon name="alert" width={16} height={16} />{err}</p>}
        <Button type="submit" block loading={busy}>Sign in</Button>
        <Link to="/forgot" className="small center">Forgot your password?</Link>
      </form>
    </AuthFrame>
  );
}

export function SignUp() {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);
  const nav = useNavigate();
  const nId = useId(), eId = useId(), pId = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!name.trim()) return setErr("Add your name so your manager knows who sent the request.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("Enter a valid email address.");
    if (pw.length < 8) return setErr("Use a password with at least 8 characters.");
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password: pw,
      options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin + "/" },
    });
    setBusy(false);
    if (error) return setErr(friendly(error));
    if (data.session) nav("/", { replace: true }); else setSent(true);
  };
  if (sent) return (
    <AuthFrame title="Check your email" lede={`We sent a confirmation link to ${email}. Open it in this browser to finish creating your account.`}
      foot={<Link to="/signin">Back to sign in</Link>}>
      <div className="notice info"><Icon name="mail" /><div>Didn't get it? Check spam, or wait a minute and try signing in.</div></div>
    </AuthFrame>
  );
  return (
    <AuthFrame title="Create your account" lede="Free for renters and property managers." foot={<>Already have an account? <Link to="/signin">Sign in</Link></>}>
      <JoinNotice />
      <GoogleButton />
      <div className="divider">or</div>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Full name" htmlFor={nId}><input id={nId} className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email" htmlFor={eId}><input id={eId} className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" hint="At least 8 characters." htmlFor={pId}><input id={pId} className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {err && <p className="err" role="alert"><Icon name="alert" width={16} height={16} />{err}</p>}
        <Button type="submit" block loading={busy}>Create account</Button>
        <p className="xs muted center" style={{ margin: 0 }}>By creating an account you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>. CanItWait uses AI to suggest urgency, so don't put sensitive personal details in reports.</p>
      </form>
    </AuthFrame>
  );
}

export function Forgot() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const eId = useId();
  return (
    <AuthFrame title="Reset your password" lede={sent ? `If ${email} has an account, a reset link is on its way.` : "We'll email you a link to set a new password."}
      foot={<Link to="/signin">Back to sign in</Link>}>
      {!sent && (
        <form className="stack" noValidate onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("Enter a valid email address.");
          setBusy(true);
          const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + "/reset" });
          setBusy(false);
          if (error) setErr(friendly(error)); else setSent(true);
        }}>
          <Field label="Email" htmlFor={eId}><input id={eId} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {err && <p className="err" role="alert">{err}</p>}
          <Button type="submit" block loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthFrame>
  );
}

export function ResetPassword() {
  const { session } = useSession();
  const nav = useNavigate();
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const pId = useId(), p2Id = useId();
  if (done) return (
    <AuthFrame title="Password updated" lede="Your new password is saved. Use it next time you sign in."><Button block onClick={() => nav("/", { replace: true })}>Continue</Button></AuthFrame>
  );
  if (!session) return (
    <AuthFrame title="Link expired" lede="This reset link is no longer valid. Request a new one." foot={<Link to="/forgot">Send a new link</Link>}><span /></AuthFrame>
  );
  return (
    <AuthFrame title="Set a new password" lede={session.user.email ? `For ${session.user.email}` : undefined}>
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        if (pw.length < 8) return setErr("Use a password with at least 8 characters.");
        if (pw !== pw2) return setErr("The passwords don't match.");
        setBusy(true);
        const { error } = await supabase.auth.updateUser({ password: pw });
        setBusy(false);
        if (error) setErr(/should be different/i.test(error.message) ? "Choose a password different from your old one." : friendly(error)); else setDone(true);
      }}>
        <Field label="New password" hint="At least 8 characters." htmlFor={pId}><input id={pId} className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Confirm new password" htmlFor={p2Id}><input id={p2Id} className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        {err && <p className="err" role="alert">{err}</p>}
        <Button type="submit" block loading={busy}>Save password</Button>
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
  return (
    <AuthFrame title="CanItWait isn't connected yet" lede="This deployment is missing its Supabase settings.">
      <div className="notice warn"><Icon name="info" /><div className="small">Add <span className="mono">VITE_SUPABASE_URL</span> and <span className="mono">VITE_SUPABASE_ANON_KEY</span> in Vercel → Settings → Environment Variables, then redeploy. See SETUP.md in the repo.</div></div>
    </AuthFrame>
  );
}
