import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { useSession } from "./lib/session";
import { Icon, type IconName } from "./ui/icons";
import { Brand } from "./auth/AuthScreens";
import { initials } from "./lib/format";

function useOpenEmergencies(enabled: boolean, ids: string[]) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled || !ids.length) { setN(0); return; }
    let alive = true;
    const load = async () => {
      const { count } = await supabase.from("requests").select("id", { count: "exact", head: true })
        .eq("urgency", "Emergency").in("status", ["new", "acknowledged"]).in("property_id", ids);
      if (alive) setN(count || 0);
    };
    void load();
    const ch = supabase.channel(`shell-emergencies-${crypto.randomUUID()}`).on("postgres_changes", { event: "*", schema: "public", table: "requests" }, () => void load()).subscribe();
    return () => { alive = false; void supabase.removeChannel(ch); };
  }, [enabled, ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return n;
}

export function AppShell() {
  const { workspace, setWorkspace, places, managed, profile } = useSession();
  const both = places.length > 0 && managed.length > 0;
  const emergencies = useOpenEmergencies(workspace === "manager", managed.map((p) => p.id));
  const nav = useNavigate();
  const items: { to: string; label: string; icon: IconName; end?: boolean; badge?: number }[] =
    workspace === "manager"
      ? [
          { to: "/m", label: "Inbox", icon: "inbox", end: true, badge: emergencies },
          { to: "/m/insights", label: "Insights", icon: "chart" },
          { to: "/m/properties", label: "Properties", icon: "building" },
          { to: "/settings", label: "Settings", icon: "settings" },
        ]
      : [
          { to: "/r", label: "Report", icon: "camera", end: true },
          { to: "/r/requests", label: "Requests", icon: "list" },
          { to: "/settings", label: "Settings", icon: "settings" },
        ];
  const link = (it: (typeof items)[number], child: ReactNode) => (
    <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? "active" : "")}>{child}</NavLink>
  );
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main">
        <Brand />
        {both && (
          <div className="seg" style={{ marginTop: 20 }} role="group" aria-label="Workspace">
            <button aria-pressed={workspace === "resident"} onClick={() => { setWorkspace("resident"); nav("/r"); }}>Resident</button>
            <button aria-pressed={workspace === "manager"} onClick={() => { setWorkspace("manager"); nav("/m"); }}>Manager</button>
          </div>
        )}
        <nav>
          {items.map((it) => link(it, <><Icon name={it.icon} /><span className="grow">{it.label}</span>{!!it.badge && <span className="badge Emergency">{it.badge}</span>}</>))}
        </nav>
        <div className="foot row" style={{ padding: "8px 4px" }}>
          <span className="avatar">{initials(profile?.full_name || "?")}</span>
          <div className="grow small"><div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile?.full_name || "Your account"}</div>
            <div className="muted xs">{workspace === "manager" ? `${managed.length} propert${managed.length === 1 ? "y" : "ies"}` : `${places.length} home${places.length === 1 ? "" : "s"}`}</div></div>
        </div>
      </aside>
      <div className="main">
        <Outlet />
      </div>
      <nav className="tabbar" aria-label="Main">
        {items.map((it) => link(it, <><Icon name={it.icon} />{it.label}{!!it.badge && <span className="dot">{it.badge}</span>}</>))}
      </nav>
    </div>
  );
}

/** Sticky title bar for phone screens; desktop shows the sidebar instead. */
export function TopBar({ title, back, right }: { title: string; back?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar mobile-only">
      {back ? <button className="icon-btn" onClick={back} aria-label="Back"><Icon name="chevronLeft" /></button> : <span className="brand-mark" aria-hidden="true"><Icon name="brand" /></span>}
      <div className="title">{title}</div>
      {right}
    </header>
  );
}
