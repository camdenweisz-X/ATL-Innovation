import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useSession } from "./lib/session";
import { configured, supabase } from "./lib/supabase";
import { useT, type Lang } from "./lib/i18n";
import { local } from "./lib/store";
import { AppShell } from "./AppShell";
import { Landing, SignIn, SignUp, Forgot, ResetPassword, JoinLink, SetupNeeded } from "./auth/AuthScreens";
import { Onboarding } from "./onboarding/Onboarding";
import { Report } from "./resident/Report";
import { MyRequests, ResidentRequestPage } from "./resident/Requests";
import { RequestRecord } from "./shared-screens/Record";
import { Inbox } from "./manager/Inbox";
import { Insights } from "./manager/Insights";
import { PropertiesList, PropertyDetail } from "./manager/Properties";
import { Settings, Places } from "./settings/Settings";
import { Admin } from "./admin/Admin";
import { Spinner } from "./ui/kit";

function Home() {
  const { session, profile, workspace } = useSession();
  if (!session) return <Landing />;
  if (!profile?.onboarded) return <Navigate to="/onboarding" replace />;
  return <Navigate to={workspace === "manager" ? "/m" : "/r"} replace />;
}

function RequireAuth({ children, onboarded = true }: { children: React.ReactNode; onboarded?: boolean }) {
  const { session, profile } = useSession();
  const loc = useLocation();
  if (!session) return <Navigate to="/signin" replace state={{ from: loc.pathname }} />;
  if (onboarded && !profile?.onboarded) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const to = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  return session ? <Navigate to={to} replace /> : <>{children}</>;
}

/**
 * Keeps the app language and the profile in step. A language picked while signed out (on the sign-in screens)
 * is saved to the account at sign-in; otherwise a set-up account's saved language wins on every device.
 */
function LangSync() {
  const { profile, user, refresh } = useSession();
  const { lang, setLang } = useT();
  useEffect(() => {
    if (!profile || !user) return;
    const pending = local.get<Lang | null>("cw_lang_pending", null);
    const want: Lang | null = pending || (!profile.onboarded ? lang : null);
    if (want && want !== profile.lang) {
      void supabase.from("profiles").update({ lang: want }).eq("id", user.id).then(() => refresh());
    } else if (!want && profile.lang && profile.lang !== lang) setLang(profile.lang);
    if (pending) local.del("cw_lang_pending");
  }, [profile?.lang, profile?.onboarded, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Managers open request links from emails; send them into the inbox's split view. */
function ManagerRequestRedirect() { const { id } = useParams(); return <Navigate to={`/m/requests/${id}`} replace />; }

export function App() {
  const { ready, loading, session } = useSession();
  const { t } = useT();
  if (!configured) return <SetupNeeded />;
  if (!ready || (session && loading)) return <div style={{ paddingTop: "30vh" }}><Spinner label={t("Loading CanItWait")} /></div>;
  return (
    <>
      <LangSync />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signin" element={<GuestOnly><SignIn /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><SignUp /></GuestOnly>} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="/join/:code" element={<JoinLink />} />
        <Route path="/onboarding" element={<RequireAuth onboarded={false}><Onboarding /></RequireAuth>} />
        <Route path="/record/:id" element={<RequireAuth><RequestRecord /></RequireAuth>} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/r" element={<Report />} />
          <Route path="/r/requests" element={<MyRequests />} />
          <Route path="/r/requests/:id" element={<ResidentRequestPage />} />
          <Route path="/m" element={<Inbox />} />
          <Route path="/m/requests/:id" element={<Inbox />} />
          <Route path="/m/r/:id" element={<ManagerRequestRedirect />} />
          <Route path="/m/insights" element={<Insights />} />
          <Route path="/m/properties" element={<PropertiesList />} />
          <Route path="/m/properties/:id" element={<PropertyDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/places" element={<Places />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
