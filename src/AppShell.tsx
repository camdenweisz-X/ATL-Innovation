import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { useSession } from "./lib/session";
import { useT } from "./lib/i18n";
import { Icon, type IconName } from "./ui/icons";
import { Brand } from "./auth/AuthScreens";
import { initials } from "./lib/format";

/** Open emergencies nobody has acknowledged yet, live. */
function useUnseenEmergencies(enabled: boolean, ids: string[]) {
  const [rows, setRows] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (!enabled || !ids.length) { setRows([]); return; }
    let alive = true;
    const load = async () => {
      const { data } = await supabase.from("requests").select("id, title, urgency, mgr_urgency")
        .eq("status", "new").in("property_id", ids).or("mgr_urgency.eq.Emergency,and(urgency.eq.Emergency,mgr_urgency.is.null)").limit(20);
      if (alive) setRows((data || []).map((r) => ({ id: r.id, title: r.title })));
    };
    void load();
    const ch = supabase.channel(`shell-emergencies-${crypto.randomUUID()}`).on("postgres_changes", { event: "*", schema: "public", table: "requests" }, () => void load()).subscribe();
    const iv = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(iv); void supabase.removeChannel(ch); };
  }, [enabled, ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}

/** A short two-tone alarm when a new emergency arrives while the app is open (browsers allow it after any tap). */
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((t0, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = i % 2 ? 660 : 880; o.type = "square";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + 0.3);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + 0.32);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch { /* no audio */ }
}

export function AppShell() {
  const { workspace, setWorkspace, places, managed, profile } = useSession();
  const { t, tn } = useT();
  const both = places.length > 0 && managed.length > 0;
  const unseen = useUnseenEmergencies(workspace === "manager", managed.map((p) => p.id));
  const known = useRef<Set<string> | null>(null);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    const ids = new Set(unseen.map((r) => r.id));
    if (known.current && unseen.some((r) => !known.current!.has(r.id))) beep();
    known.current = ids;
  }, [unseen]);

  const items: { to: string; label: string; icon: IconName; end?: boolean; badge?: number }[] =
    workspace === "manager"
      ? [
          { to: "/m", label: t("Inbox"), icon: "inbox", end: true, badge: unseen.length },
          { to: "/m/insights", label: t("Insights"), icon: "chart" },
          { to: "/m/properties", label: t("Properties"), icon: "building" },
          { to: "/settings", label: t("Settings"), icon: "settings" },
        ]
      : [
          { to: "/r", label: t("Report"), icon: "camera", end: true },
          { to: "/r/requests", label: t("Requests"), icon: "list" },
          { to: "/settings", label: t("Settings"), icon: "settings" },
        ];
  const link = (it: (typeof items)[number], child: ReactNode) => (
    <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? "active" : "")}>{child}</NavLink>
  );
  const onThatRequest = unseen.length === 1 && loc.pathname.endsWith(unseen[0].id);
  return (
    <div className="shell">
      <aside className="sidebar" aria-label={t("Main")}>
        <Brand />
        {both && (
          <div className="seg" style={{ marginTop: 20 }} role="group" aria-label={t("Workspace")}>
            <button aria-pressed={workspace === "resident"} onClick={() => { setWorkspace("resident"); nav("/r"); }}>{t("Resident")}</button>
            <button aria-pressed={workspace === "manager"} onClick={() => { setWorkspace("manager"); nav("/m"); }}>{t("Manager")}</button>
          </div>
        )}
        <nav>
          {items.map((it) => link(it, <><Icon name={it.icon} /><span className="grow">{it.label}</span>{!!it.badge && <span className="badge Emergency">{it.badge}</span>}</>))}
        </nav>
        <div className="foot row" style={{ padding: "8px 4px" }}>
          <span className="avatar">{initials(profile?.full_name || "?")}</span>
          <div className="grow small"><div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile?.full_name || t("Your account")}</div>
            <div className="muted xs">{workspace === "manager" ? tn(managed.length, "{n} property", "{n} properties") : tn(places.length, "{n} home", "{n} homes")}</div></div>
        </div>
      </aside>
      <div className="main">
        {workspace === "manager" && unseen.length > 0 && !onThatRequest && (
          <Link to={`/m/requests/${unseen[0].id}`} className="emer-banner" role="alert">
            <Icon name="alert" />
            <span className="grow">{unseen.length === 1 ? t("Emergency not acknowledged: {title}", { title: unseen[0].title }) : t("{n} emergencies not acknowledged", { n: unseen.length })}</span>
            <span className="go">{t("Open")}</span>
          </Link>
        )}
        <Outlet />
      </div>
      <nav className="tabbar" aria-label={t("Main")}>
        {items.map((it) => link(it, <><Icon name={it.icon} />{it.label}{!!it.badge && <span className="dot">{it.badge}</span>}</>))}
      </nav>
    </div>
  );
}

/** Sticky title bar for phone screens; desktop shows the sidebar instead. */
export function TopBar({ title, back, right }: { title: string; back?: () => void; right?: ReactNode }) {
  const { t } = useT();
  return (
    <header className="topbar mobile-only">
      {back ? <button className="icon-btn" onClick={back} aria-label={t("Back")}><Icon name="chevronLeft" /></button> : <span className="brand-mark" aria-hidden="true"><Icon name="brand" /></span>}
      <div className="title">{title}</div>
      {right}
    </header>
  );
}
