// Owner-only dashboard: who signed up and what kind of activity happened. Shows metadata only, never content.
// English only on purpose: it's an internal tool for the team, not part of the resident or manager app.
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAdmin } from "../lib/api";
import { ago, stampLong } from "../lib/format";
import type { AdminEvent, AdminReport } from "../../shared/admin.js";
import { Button, Empty, Skeleton } from "../ui/kit";
import { Icon, type IconName } from "../ui/icons";
import { TopBar } from "../AppShell";

const FILTERS: { k: "all" | AdminEvent["type"][]; label: string }[] = [
  { k: "all", label: "Everything" },
  { k: ["signup"], label: "Sign-ups" },
  { k: ["signin"], label: "Sign-ins" },
  { k: ["request"], label: "Requests" },
  { k: ["ai"], label: "AI checks" },
  { k: ["update", "message", "property", "join", "home"], label: "Other activity" },
];
const ICON: Record<AdminEvent["type"], IconName> = {
  signup: "user", signin: "key", property: "building", join: "building", home: "home", request: "send", update: "clock", message: "message", ai: "sparkle",
};
const REFRESH_MS = 60_000;

export function Admin() {
  const [data, setData] = useState<AdminReport | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "error">("loading");
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState(0);
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetchAdmin();
      if (!r) { setState("denied"); return; }
      setData(r as AdminReport); setState("ok"); setErr("");
    } catch (e) {
      setErr(String((e as Error)?.message || e)); setState((s) => (s === "ok" ? "ok" : "error"));
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void load();
    // Keep it live while the tab is open, so new sign-ups show up on their own.
    const id = setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    const onVis = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const label = useMemo(() => new Map((data?.accounts || []).map((a) => [a.id, a.email || a.short_id])), [data]);
  const feed = useMemo(() => {
    const f = FILTERS[filter].k;
    return (data?.feed || []).filter((e) => (f === "all" || f.includes(e.type)) && (!who || e.user_id === who));
  }, [data, filter, who]);

  if (state === "denied") {
    return (<><TopBar title="Admin" /><div className="page"><Empty icon="lock" title="Not available">This page is only for the CanItWait team.</Empty></div></>);
  }

  const s = data?.summary;
  return (
    <>
      <TopBar title="Admin" />
      <div className="page-wide stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="h1">Admin dashboard</h1>
            <p className="lede">Sign-ups and activity across CanItWait. Updates every minute.</p>
          </div>
          <Button variant="secondary" size="sm" icon="refresh" loading={busy} onClick={() => void load()}>Refresh</Button>
        </div>

        {state === "error" && <p className="err" role="alert"><Icon name="alert" width={16} height={16} />{err || "Couldn't load the dashboard."}</p>}
        {state === "ok" && err && <p className="small muted" style={{ margin: 0 }}>Last refresh failed ({err}). Showing data from {data ? ago(data.generated_at) : "earlier"}.</p>}

        {!s ? (state === "loading" ? <Skeleton h={88} n={3} /> : null) : (<>
          <div className="tiles">
            <div className="tile hero"><span className="k">Accounts</span><b>{s.accounts}</b><span className="s">{s.new_7d} new this week · {s.set_up} finished setup</span></div>
            <div className="tile"><span className="k">Active this week</span><b>{s.active_7d}</b><span className="s">Signed in or did something</span></div>
            <div className="tile"><span className="k">Requests sent</span><b>{s.requests}</b><span className="s">{s.requests_7d} this week · {s.properties} {s.properties === 1 ? "property" : "properties"}</span></div>
            <div className="tile"><span className="k">Urgency checks</span><b>{s.checks_24h}</b><span className="s">In the last 24 hours</span></div>
            <div className="tile wide"><span className="k">Residents who kept the AI's urgency</span><b>{s.ai_kept_rate != null ? `${s.ai_kept_rate}%` : "—"}</b>
              <span className="s">{s.ai_judged ? `Of ${s.ai_judged} ${s.ai_judged === 1 ? "request" : "requests"} sent after an AI check. Tests whether people trust the AI's call.` : "Shows once requests are sent after an AI check."}</span></div>
          </div>

          <section className="stack">
            <div className="between"><h2 className="h2">Accounts</h2>{who && <button className="btn ghost sm" onClick={() => setWho(null)}>Show everyone</button>}</div>
            {data!.accounts.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No accounts yet.</p> : (
              <div className="list">
                {data!.accounts.map((a) => (
                  <button key={a.id} className="list-row" aria-pressed={who === a.id} onClick={() => setWho(who === a.id ? null : a.id)} style={who === a.id ? { background: "var(--accent-soft)" } : undefined}>
                    <Icon name="user" width={20} height={20} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{a.email || `Account ${a.short_id}`}</div>
                      <div className="small muted">
                        {a.method} · joined {ago(a.joined)}{a.roles.length ? ` · ${a.roles.join(" & ")}` : ""}{a.set_up ? "" : " · setup not finished"}
                        {a.requests ? ` · ${a.requests} ${a.requests === 1 ? "request" : "requests"}` : ""}{a.lang === "es" ? " · Spanish" : ""}
                      </div>
                    </div>
                    <span className="small muted" title={stampLong(a.last_active)} style={{ flex: "none" }}>active {ago(a.last_active)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="stack">
            <h2 className="h2">Activity{who ? ` for ${label.get(who)}` : ""}</h2>
            <div className="row-wrap">
              {FILTERS.map((f, i) => <button key={f.label} type="button" className="chip" aria-pressed={filter === i} onClick={() => setFilter(i)}>{f.label}</button>)}
            </div>
            {feed.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing here yet.</p> : (
              <div className="list">
                {feed.map((e, i) => (
                  <div key={`${e.at}-${i}`} className="list-row" style={{ cursor: "default", alignItems: "flex-start" }}>
                    <Icon name={ICON[e.type]} width={18} height={18} style={{ marginTop: 2, color: "var(--muted)" }} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div>{e.text}</div>
                      <div className="small muted" style={{ overflowWrap: "anywhere" }}>{e.user_id ? label.get(e.user_id) || "Deleted account" : "System"}</div>
                    </div>
                    <span className="small muted" title={stampLong(e.at)} style={{ flex: "none" }}>{ago(e.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <p className="xs muted" style={{ margin: 0 }}>Shows what kind of thing happened and when, not what people wrote or photographed. Email addresses are partly hidden. AI check counts cover the last 24 hours.</p>
        </>)}
      </div>
    </>
  );
}
