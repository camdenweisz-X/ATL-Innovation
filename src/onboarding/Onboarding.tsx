import { useId, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase, friendly } from "../lib/supabase";
import { local } from "../lib/store";
import { useSession } from "../lib/session";
import { Button, Field } from "../ui/kit";
import { Icon } from "../ui/icons";
import { Brand } from "../auth/AuthScreens";
import { JoinForm, ExternalPlaceForm, CreatePropertyForm } from "../shared-screens/PlaceForms";

type Step = "name" | "role" | "resident" | "external" | "manager" | "team";

/** First-run setup: name → how you'll use CanItWait → connect a place or create a property. */
export function Onboarding() {
  const { profile, user, refresh, setWorkspace, signOut } = useSession();
  const nav = useNavigate();
  const hasJoinCode = !!local.get<string | null>("fc_join", null);
  const joinIsMgr = String(local.get<string>("fc_join", "")).startsWith("M-");
  const [step, setStep] = useState<Step>(profile?.full_name ? (hasJoinCode ? (joinIsMgr ? "team" : "resident") : "role") : "name");
  const [name, setName] = useState(profile?.full_name || (user?.user_metadata?.full_name as string) || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nId = useId(), pId = useId();
  if (profile?.onboarded && step === "name") return <Navigate to="/" replace />;

  const finish = async (ws: "resident" | "manager") => {
    await supabase.from("profiles").update({ onboarded: true }).eq("id", user!.id);
    setWorkspace(ws);
    await refresh();
    nav(ws === "manager" ? "/m" : "/r", { replace: true });
  };

  const stepIndex = { name: 1, role: 2, resident: 3, external: 3, manager: 3, team: 3 }[step];

  return (
    <div className="auth">
      <div className="auth-inner">
        <div className="between"><Brand /><button className="btn ghost sm" onClick={() => signOut()}>Sign out</button></div>
        <ol className="steps" aria-label={`Step ${stepIndex} of 3`}>
          {["About you", "Your role", "Connect"].map((s, i) => <li key={s} className={i + 1 < stepIndex ? "done" : i + 1 === stepIndex ? "on" : ""}>{s}</li>)}
        </ol>

        {step === "name" && (
          <div className="auth-card stack-lg">
            <div><h1 className="h1" style={{ fontSize: 26 }}>Welcome to CanItWait</h1><p className="lede">Your name goes on requests so maintenance knows who to contact.</p></div>
            <form className="stack" noValidate onSubmit={async (e) => {
              e.preventDefault(); setErr(null);
              if (!name.trim()) return setErr("Add your name.");
              setBusy(true);
              const { error } = await supabase.from("profiles").update({ full_name: name.trim(), phone: phone.trim() || null }).eq("id", user!.id);
              setBusy(false);
              if (error) return setErr(friendly(error));
              await refresh();
              setStep(hasJoinCode ? (joinIsMgr ? "team" : "resident") : "role");
            }}>
              <Field label="Full name" htmlFor={nId}><input id={nId} className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Mobile number" optional hint="Shared with managers of properties you join. If you manage properties, your residents see it too." htmlFor={pId}><input id={pId} className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              {err && <p className="err" role="alert">{err}</p>}
              <Button type="submit" block loading={busy}>Continue</Button>
            </form>
          </div>
        )}

        {step === "role" && (
          <div className="stack-lg">
            <div><h1 className="h1" style={{ fontSize: 26 }}>How will you use CanItWait?</h1><p className="lede">You can add the other later in Settings.</p></div>
            <div className="stack">
              <button className="role-card" onClick={() => setStep("resident")}>
                <span className="ico"><Icon name="home" /></span>
                <span className="stack-sm" style={{ gap: 2 }}><span className="h3">I rent a home</span><span className="small muted">Report problems, get an urgency call, and track repairs.</span></span>
              </button>
              <button className="role-card" onClick={() => setStep("manager")}>
                <span className="ico"><Icon name="building" /></span>
                <span className="stack-sm" style={{ gap: 2 }}><span className="h3">I manage properties</span><span className="small muted">Get an inbox sorted by urgency and invite your residents with a code.</span></span>
              </button>
            </div>
          </div>
        )}

        {step === "resident" && (
          <div className="auth-card stack-lg">
            <div><h1 className="h1" style={{ fontSize: 26 }}>Connect your home</h1><p className="lede">Enter the code from your property manager so your requests go straight to them.</p></div>
            <JoinForm onDone={(r) => finish(r.role === "manager" ? "manager" : "resident")} submitLabel="Connect" />
            <div className="divider">or</div>
            <Button variant="secondary" block onClick={() => setStep("external")}>My landlord doesn't use CanItWait</Button>
            <button className="btn ghost sm" onClick={() => { local.del("fc_join"); setStep("role"); }}><Icon name="chevronLeft" />Back</button>
          </div>
        )}

        {step === "external" && (
          <div className="auth-card stack-lg">
            <div><h1 className="h1" style={{ fontSize: 26 }}>Add your home</h1><p className="lede">CanItWait drafts each request, then opens your email or texting app so you can send it to your landlord.</p></div>
            <ExternalPlaceForm onDone={() => finish("resident")} />
            <button className="btn ghost sm" onClick={() => setStep("resident")}><Icon name="chevronLeft" />Back</button>
          </div>
        )}

        {step === "manager" && (
          <div className="auth-card stack-lg">
            <div><h1 className="h1" style={{ fontSize: 26 }}>Add your first property</h1><p className="lede">You'll get a code to share with residents. You can add more properties later.</p></div>
            <CreatePropertyForm onDone={() => finish("manager")} />
            <div className="divider">or</div>
            <Button variant="secondary" block onClick={() => setStep("team")}>Join a team with a co-manager code</Button>
            <button className="btn ghost sm" onClick={() => setStep("role")}><Icon name="chevronLeft" />Back</button>
          </div>
        )}

        {step === "team" && (
          <div className="auth-card stack-lg">
            <div><h1 className="h1" style={{ fontSize: 26 }}>Join your team</h1><p className="lede">Enter the co-manager code another manager shared with you. It starts with M-.</p></div>
            <JoinForm onDone={(r) => finish(r.role === "manager" ? "manager" : "resident")} />
            <button className="btn ghost sm" onClick={() => setStep("manager")}><Icon name="chevronLeft" />Back</button>
          </div>
        )}
      </div>
    </div>
  );
}
