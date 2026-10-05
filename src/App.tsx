import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useSession } from "./lib/session";
import { configured } from "./lib/supabase";
import { AppShell } from "./AppShell";
import { Landing, SignIn, SignUp, Forgot, ResetPassword, JoinLink, SetupNeeded } from "./auth/AuthScreens";
import { Onboarding } from "./onboarding/Onboarding";
import { Report } from "./resident/Report";
import { MyRequests, ResidentRequestPage } from "./resident/Requests";
import { Inbox } from "./manager/Inbox";
import { PropertiesList, PropertyDetail } from "./manager/Properties";
import { Settings, Places } from "./settings/Settings";
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

/** Managers open request links from emails; send them into the inbox's split view. */
function ManagerRequestRedirect() { const { id } = useParams(); return <Navigate to={`/m/requests/${id}`} replace />; }

export function App() {
  const { ready, loading, session } = useSession();
  if (!configured) return <SetupNeeded />;
  if (!ready || (session && loading)) return <div style={{ paddingTop: "30vh" }}><Spinner label="Loading FixCheck" /></div>;
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/signin" element={<GuestOnly><SignIn /></GuestOnly>} />
      <Route path="/signup" element={<GuestOnly><SignUp /></GuestOnly>} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset" element={<ResetPassword />} />
      <Route path="/join/:code" element={<JoinLink />} />
      <Route path="/onboarding" element={<RequireAuth onboarded={false}><Onboarding /></RequireAuth>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/r" element={<Report />} />
        <Route path="/r/requests" element={<MyRequests />} />
        <Route path="/r/requests/:id" element={<ResidentRequestPage />} />
        <Route path="/m" element={<Inbox />} />
        <Route path="/m/requests/:id" element={<Inbox />} />
        <Route path="/m/r/:id" element={<ManagerRequestRedirect />} />
        <Route path="/m/properties" element={<PropertiesList />} />
        <Route path="/m/properties/:id" element={<PropertyDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/places" element={<Places />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
