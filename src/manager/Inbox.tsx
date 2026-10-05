import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RANK } from "../../shared/triage.js";
import { finalUrgency, findRepeats, type RepeatAlert } from "../../shared/workorders.js";
import { supabase, PHOTO_BUCKET } from "../lib/supabase";
import { useSession } from "../lib/session";
import { ago, ageLevel, plural, visitTime } from "../lib/format";
import { useMedia } from "../lib/hooks";
import type { RequestRow, Urgency } from "../lib/types";
import { Button, Empty, Skeleton, StatusBadge, UrgencyBadge, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { TopBar } from "../AppShell";
import { RequestDetail } from "../shared-screens/RequestDetail";

type Filter = "open" | "done" | "all";
const OPEN = ["new", "acknowledged", "scheduled", "in_progress"];

export function Inbox() {
  const { managed, refresh } = useSession();
  const { id: selected } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [prop, setProp] = useState<string>("all");
  const [filter, setFilter] = useState<Filter>("open");
  const [urg, setUrg] = useState<Urgency | null>(null);
  const known = useRef<Set<string> | null>(null);
  const wide = useMedia("(min-width: 960px)");

  const load = useCallback(async () => {
    const ids = managed.map((p) => p.id);
    if (!ids.length) { setRows([]); return; }
    const { data } = await supabase.from("requests").select("*").in("property_id", ids).order("created_at", { ascending: false }).limit(500);
    const list = (data as RequestRow[]) || [];
    // Tell the manager about new requests that arrive while the inbox is open.
    if (known.current) {
      const fresh = list.filter((r) => !known.current!.has(r.id));
      if (fresh.length && fresh.length < 5) toast(fresh.length === 1 ? `New ${fresh[0].urgency.toLowerCase()} request: ${fresh[0].title}` : `${fresh.length} new requests`, "info");
    }
    known.current = new Set(list.map((r) => r.id));
    setRows(list);
    const people = Array.from(new Set(list.map((r) => r.resident_id)));
    if (people.length) {
      const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", people);
      setNames(Object.fromEntries((ps || []).map((p) => [p.id, p.full_name])));
    }
    const paths = list.map((r) => r.photo_path).filter(Boolean).slice(0, 60) as string[];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
      setThumbs(Object.fromEntries((signed || []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl])));
    }
  }, [managed, toast]);

  useEffect(() => {
    void load();
    const ch = supabase.channel(`inbox-${crypto.randomUUID()}`).on("postgres_changes", { event: "*", schema: "public", table: "requests" }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load]);

  const propName = (id: string | null) => managed.find((p) => p.id === id)?.name || "";
  const base = useMemo(() => (rows || []).filter((r) => prop === "all" || r.property_id === prop), [rows, prop]);
  const counts = useMemo(() => {
    const open = base.filter((r) => OPEN.includes(r.status));
    const n = (u: Urgency) => open.filter((r) => finalUrgency(r) === u).length;
    return { Emergency: n("Emergency"), Urgent: n("Urgent"), Routine: n("Routine") };
  }, [base]);
  const repeats = useMemo(() => findRepeats(base), [base]);
  const shown = useMemo(() => base
    .filter((r) => filter === "all" || (filter === "open" ? OPEN.includes(r.status) : !OPEN.includes(r.status)))
    .filter((r) => !urg || finalUrgency(r) === urg)
    .sort((a, b) => {
      const ao = OPEN.includes(a.status) ? 1 : 0, bo = OPEN.includes(b.status) ? 1 : 0;
      return bo - ao || RANK[finalUrgency(b)] - RANK[finalUrgency(a)] || b.created_at.localeCompare(a.created_at);
    }), [base, filter, urg]);

  if (!managed.length) {
    return (<><TopBar title="Inbox" /><div className="page"><Empty icon="building" title="Add your first property" action={<Link className="btn" to="/m/properties?new=1">Add property</Link>}>Create a property to get a resident code. Requests from residents who use it land here.</Empty></div></>);
  }

  const list = (
    <div className="stack">
      <div className="stats" role="group" aria-label="Open requests by urgency">
        {(["Emergency", "Urgent", "Routine"] as Urgency[]).map((u) => (
          <button key={u} className={`stat ${u}`} aria-pressed={urg === u} onClick={() => { setUrg(urg === u ? null : u); setFilter("open"); }}>
            <b>{counts[u]}</b><span>{u}</span>
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        {managed.length > 1 && (
          <select className="select" style={{ height: 40, padding: "0 36px 0 12px", fontSize: 14, width: "auto", maxWidth: "50%" }} aria-label="Property" value={prop} onChange={(e) => setProp(e.target.value)}>
            <option value="all">All properties</option>
            {managed.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div className="seg grow" role="group" aria-label="Status">
          {(["open", "done", "all"] as Filter[]).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "open" ? "Open" : f === "done" ? "Closed" : "All"}</button>)}
        </div>
      </div>
      {repeats.alerts.length > 0 && filter === "open" && !urg && (
        <div className="stack-sm">
          {repeats.alerts.slice(0, 2).map((a, i) => <AlertCard key={i} a={a} propName={managed.length > 1 ? propName(a.property_id) : ""} />)}
          {repeats.alerts.length > 2 && <Link to="/m/insights" className="small" style={{ fontWeight: 600 }}>{repeats.alerts.length - 2} more in Insights</Link>}
        </div>
      )}
      {!rows ? <Skeleton h={84} n={4} /> : shown.length === 0 ? (
        <Empty icon="inbox" title={filter === "open" ? "You're all caught up" : "Nothing here"}
          action={rows.length === 0 ? <SampleButton onDone={async () => { await refresh(); }} /> : undefined}>
          {filter === "open" ? "New requests from your residents appear here automatically, emergencies first." : "Try another filter."}
          {rows.length === 0 && " Want to see how it works? Load a sample property with six weeks of requests."}
        </Empty>
      ) : (
        <div className="list">
          {shown.map((r) => {
            const lvl = ageLevel(r.created_at, r.urgency, r.status);
            const thumb = r.photo_path ? thumbs[r.photo_path] : null;
            return (
              <Link key={r.id} to={`/m/requests/${r.id}`} className={`req ${finalUrgency(r)} ${OPEN.includes(r.status) ? "" : "closed"} ${selected === r.id ? "active" : ""}`}>
                {thumb ? <img className="thumb" src={thumb} alt="" loading="lazy" /> : null}
                <div className="grow">
                  <div className="between" style={{ gap: 6 }}>
                    <div className="row-wrap" style={{ gap: 6 }}><UrgencyBadge u={finalUrgency(r)} />{r.status !== "new" && <StatusBadge s={r.status} manager />}
                      {repeats.byId[r.id]?.count && <span className="badge warn" title="Same unit, same kind of problem"><Icon name="refresh" />Repeat</span>}</div>
                    <span className={`age ${lvl}`} title={lvl ? "Waiting longer than its urgency allows" : undefined}><Icon name="clock" />{ago(r.created_at)}</span>
                  </div>
                  <div className="title">{r.title}</div>
                  <div className="meta row" style={{ gap: 6 }}>
                    {r.entry_permission && <Icon name="unlock" width={14} height={14} style={{ color: "var(--rout)", flex: "none" }} aria-label="Entry allowed" />}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{names[r.resident_id] || "Resident"}{r.unit ? ` · ${r.unit}` : ""}{managed.length > 1 ? ` · ${propName(r.property_id)}` : ""}</span>
                  </div>
                  {r.status === "scheduled" && r.scheduled_for && <div className="xs" style={{ marginTop: 4, fontWeight: 600, color: "var(--info)" }}>Visit {visitTime(r.scheduled_for)}{r.tech ? ` · ${r.tech}` : ""}</div>}
                  {r.manual_review && <div className="xs" style={{ marginTop: 4, color: "var(--urg)", fontWeight: 600 }}>Needs manual review</div>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );

  if (selected && !wide) {
    return (<><TopBar title="Request" back={() => nav("/m")} /><div className="page"><RequestDetail id={selected} mode="manager" repeat={repeats.byId[selected]} /></div></>);
  }
  return (
    <>
      <TopBar title="Inbox" />
      <div className="page-wide">
        <div className="page-head"><div><h1 className="h1">Inbox</h1><p className="lede">Open requests, emergencies first. Updates live.</p></div></div>
        <div className="split">
          {list}
          <div className="detail-pane desktop-only">
            {selected ? <div className="card pad"><RequestDetail id={selected} mode="manager" repeat={repeats.byId[selected]} /></div>
              : <div className="empty" style={{ minHeight: 320, justifyContent: "center" }}><div className="ico"><Icon name="inbox" /></div><div className="muted">Select a request to see details, change its status, and message the resident.</div></div>}
          </div>
        </div>
      </div>
    </>
  );
}

export function AlertCard({ a, propName }: { a: RepeatAlert; propName?: string }) {
  const title = a.kind === "building" ? `Possible building-wide problem: ${a.category}`
    : `${a.unit}: ${a.category} reported ${a.count} times`;
  const sub = a.kind === "building"
    ? `${a.units} units reported it within ${plural(a.days, "day")} (${(a.unitNames || []).join(", ")}). Check shared equipment before sending a tech to each unit.`
    : `${plural(a.count, "report")} in ${plural(a.days, "day")}. ${a.level === "high" ? "Look for the root cause instead of another patch." : "Worth checking whether the last fix held."}`;
  return (
    <div className="notice warn" role="note">
      <Icon name={a.kind === "building" ? "building" : "refresh"} />
      <div className="small"><b>{title}</b>{propName ? ` · ${propName}` : ""}<div className="muted" style={{ marginTop: 2 }}>{sub}</div></div>
    </div>
  );
}

/** Creates a separate "Sample data" property owned by this manager, full of realistic history. */
export function SampleButton({ onDone, variant = "secondary" }: { onDone: () => void | Promise<void>; variant?: "secondary" | "ghost" }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button variant={variant} size="sm" icon="sparkle" loading={busy} onClick={async () => {
      setBusy(true);
      const { error } = await supabase.rpc("load_demo_data");
      setBusy(false);
      if (error) return toast(error.message, "error");
      toast("Sample property added. Delete it from Properties when you're done.");
      await onDone();
    }}>Load sample data</Button>
  );
}
