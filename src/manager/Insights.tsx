import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { computeInsights, findRepeats, type WOEvent } from "../../shared/workorders.js";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { local } from "../lib/store";
import { duration, money, plural } from "../lib/format";
import type { RequestRow } from "../lib/types";
import { Empty, Field, Skeleton } from "../ui/kit";
import { TopBar } from "../AppShell";
import { AlertCard, SampleButton } from "./Inbox";

export function Insights() {
  const { managed, refresh, user } = useSession();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [events, setEvents] = useState<Record<string, WOEvent[]>>({});
  const [period, setPeriod] = useState<30 | 0>(30);
  const [prop, setProp] = useState("all");
  const costKey = `cw_costs_${user?.id}`;
  const [costs, setCosts] = useState<{ callout: string; trip: string }>(local.get(costKey, { callout: "", trip: "" }));

  useEffect(() => {
    let alive = true;
    (async () => {
      const ids = managed.map((p) => p.id);
      if (!ids.length) { setRows([]); return; }
      const { data } = await supabase.from("requests").select("*").in("property_id", ids).order("created_at", { ascending: false }).limit(1000);
      const list = (data as RequestRow[]) || [];
      const byId: Record<string, WOEvent[]> = {};
      for (let i = 0; i < list.length; i += 150) {
        const { data: ev } = await supabase.from("request_events").select("request_id, kind, status, created_at").eq("kind", "status").in("request_id", list.slice(i, i + 150).map((r) => r.id));
        for (const e of ev || []) (byId[e.request_id] ||= []).push(e);
      }
      if (alive) { setRows(list); setEvents(byId); }
    })();
    return () => { alive = false; };
  }, [managed]);

  const base = useMemo(() => (rows || []).filter((r) => prop === "all" || r.property_id === prop), [rows, prop]);
  const k = useMemo(() => computeInsights(base, events, { sinceDays: period, calloutCost: costs.callout, tripCost: costs.trip }), [base, events, period, costs]);
  const rep = useMemo(() => findRepeats(base), [base]);
  const setCost = (key: "callout" | "trip", v: string) => { const c = { ...costs, [key]: v.replace(/[^\d.]/g, "") }; setCosts(c); local.set(costKey, c); };
  const propName = (id: string | null) => managed.find((p) => p.id === id)?.name || "";
  const maxC = Math.max(1, ...k.byCategory.map((c) => c[1]));

  return (
    <>
      <TopBar title="Insights" />
      <div className="page stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div><h1 className="h1">Insights</h1><p className="lede">How your maintenance is going, from your own requests.</p></div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {managed.length > 1 && (
            <select className="select" style={{ height: 40, padding: "0 36px 0 12px", fontSize: 14, width: "auto" }} aria-label="Property" value={prop} onChange={(e) => setProp(e.target.value)}>
              <option value="all">All properties</option>
              {managed.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="seg" role="group" aria-label="Period" style={{ minWidth: 220 }}>
            <button aria-pressed={period === 30} onClick={() => setPeriod(30)}>Last 30 days</button>
            <button aria-pressed={period === 0} onClick={() => setPeriod(0)}>All time</button>
          </div>
        </div>

        {!rows ? <Skeleton h={96} n={3} /> : k.total === 0 ? (
          <Empty icon="chart" title={period ? "No requests in the last 30 days" : "No requests yet"} action={rows.length === 0 ? <SampleButton onDone={refresh} /> : undefined}>
            Numbers appear here as residents send requests and your team updates them.
          </Empty>
        ) : (<>
          <p className="small muted" style={{ margin: 0 }}>{plural(k.total, "request")} {period ? "in the last 30 days" : "in total"} · {k.open} open</p>
          <div className="tiles">
            {k.calloutSavings != null ? (
              <div className="tile wide hero"><span className="k">After-hours call-outs avoided (estimate)</span><b>{money(k.calloutSavings)}</b>
                <span className="s">{plural(k.couldWait, "after-hours report")} could wait until morning, out of {k.afterHours}. Assumes each would otherwise have been a {money(Number(costs.callout))} call-out.</span></div>
            ) : (
              <div className="tile wide hero"><span className="k">After-hours reports that could wait</span><b>{k.couldWait}</b>
                <span className="s">out of {plural(k.afterHours, "after-hours report")}. Add your call-out cost below to see an estimated savings.</span></div>
            )}
            <div className="tile"><span className="k">Emergencies</span><b>{k.emergencies}</b><span className="s">{k.emergencyAckMs != null ? `Median ${duration(k.emergencyAckMs)} to first response` : "No response times yet"}</span></div>
            <div className="tile"><span className="k">Median time to fix</span><b>{duration(k.fixMs)}</b><span className="s">{k.fixed} fixed, {k.open} still open</span></div>
            <div className="tile"><span className="k">Fixed on first visit</span><b>{k.firstVisitRate != null ? `${k.firstVisitRate}%` : "—"}</b>
              <span className="s">{k.firstVisitRate != null ? `${plural(k.returnTrips, "return trip")}${k.returnTripCost != null ? `, about ${money(k.returnTripCost)}` : ""}` : "Recorded when you mark a request fixed"}</span></div>
            <div className="tile"><span className="k">Complete on arrival</span><b>{k.completeRate != null ? `${k.completeRate}%` : "—"}</b><span className="s">Sent with a photo and no blanks left to fill</span></div>
            <div className="tile wide"><span className="k">AI urgency kept by your team</span><b>{k.keptRate != null ? `${k.keptRate}%` : "—"}</b>
              <span className="s">{k.reviewed ? `Of ${plural(k.reviewed, "reviewed request")}, how many kept the urgency the AI suggested. Change a request's urgency in the inbox when it's wrong.` : "Shows once your team has reviewed requests."}</span></div>
          </div>

          <section className="card pad stack">
            <h2 className="h2">Repeat problems</h2>
            {rep.alerts.length ? <div className="stack-sm">{rep.alerts.map((a, i) => <AlertCard key={i} a={a} propName={managed.length > 1 ? propName(a.property_id) : ""} />)}</div>
              : <p className="small muted" style={{ margin: 0 }}>Nothing repeating in the last 60 days. CanItWait flags a unit that reports the same kind of problem twice, and 3 or more units reporting the same problem within a week.</p>}
          </section>

          <section className="card pad stack">
            <h2 className="h2">Requests by category</h2>
            <div className="bars">
              {k.byCategory.map(([c, n]) => (
                <div className="bar" key={c}><span>{c}</span><span className="v">{n}</span><div className="track"><div className="fill" style={{ width: `${Math.max(4, Math.round((100 * n) / maxC))}%` }} /></div></div>
              ))}
            </div>
          </section>

          <section className="card pad stack">
            <div><h2 className="h2">Your costs</h2><p className="hint" style={{ margin: "4px 0 0" }}>Used only for the estimates above. Saved on this device.</p></div>
            <div className="tiles" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <Field label="After-hours call-out" htmlFor="cost-callout"><div className="money"><input id="cost-callout" className="input" inputMode="decimal" placeholder="0" value={costs.callout} onChange={(e) => setCost("callout", e.target.value)} /></div></Field>
              <Field label="Extra technician trip" htmlFor="cost-trip"><div className="money"><input id="cost-trip" className="input" inputMode="decimal" placeholder="0" value={costs.trip} onChange={(e) => setCost("trip", e.target.value)} /></div></Field>
            </div>
          </section>
          {rows.length > 0 && <p className="xs muted">Sample property loaded? Delete it from <Link to="/m/properties">Properties</Link> when you're done.</p>}
        </>)}
      </div>
    </>
  );
}
