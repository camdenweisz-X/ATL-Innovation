import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useT } from "../lib/i18n";
import { ago, visitTime } from "../lib/format";
import { finalUrgency } from "../../shared/workorders.js";
import type { RequestRow } from "../lib/types";
import { Empty, Skeleton, StatusBadge, UrgencyBadge } from "../ui/kit";
import { Icon } from "../ui/icons";
import { TopBar } from "../AppShell";
import { RequestDetail } from "../shared-screens/RequestDetail";

export function MyRequests() {
  const { user, memberships, externalPlaces } = useSession();
  const { t } = useT();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [tab, setTab] = useState<"open" | "closed">("open");
  const load = useCallback(async () => {
    const { data } = await supabase.from("requests").select("*").eq("resident_id", user!.id).order("created_at", { ascending: false }).limit(200);
    setRows((data as RequestRow[]) || []);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
    const ch = supabase.channel(`my-requests-${crypto.randomUUID()}`).on("postgres_changes", { event: "*", schema: "public", table: "requests", filter: `resident_id=eq.${user!.id}` }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const placeName = (r: RequestRow) => memberships.find((m) => m.property_id === r.property_id)?.property?.name || externalPlaces.find((e) => e.id === r.external_place_id)?.label || "";
  const shown = (rows || []).filter((r) => (tab === "open") === !["resolved", "canceled"].includes(r.status));
  return (
    <>
      <TopBar title={t("My requests")} />
      <div className="page stack-lg">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div><h1 className="h1">{t("My requests")}</h1><p className="lede">{t("Everything you've reported, with the latest status.")}</p></div>
          {!!rows?.length && <Link to="/record/all" className="btn secondary sm"><Icon name="printer" />{t("Records")}</Link>}
        </div>
        <div className="seg" role="group" aria-label={t("Filter")}>
          <button aria-pressed={tab === "open"} onClick={() => setTab("open")}>{t("Open")}</button>
          <button aria-pressed={tab === "closed"} onClick={() => setTab("closed")}>{t("Closed")}</button>
        </div>
        {!rows ? <Skeleton /> : shown.length === 0 ? (
          <Empty icon="list" title={tab === "open" ? t("No open requests") : t("Nothing closed yet")} action={tab === "open" ? <Link to="/r" className="btn">{t("Report a problem")}</Link> : undefined}>
            {tab === "open" ? t("When you report something, it shows up here with its status and any messages from maintenance.") : t("Fixed and canceled requests show up here.")}
          </Empty>
        ) : (
          <div className="list">
            {shown.map((r) => (
              <Link key={r.id} to={`/r/requests/${r.id}`} className={`req ${finalUrgency(r)} ${["resolved", "canceled"].includes(r.status) ? "closed" : ""}`}>
                <div className="grow">
                  <div className="row-wrap" style={{ gap: 6 }}><UrgencyBadge u={finalUrgency(r)} /><StatusBadge s={r.status} /></div>
                  <div className="title">{r.title}</div>
                  {r.status === "scheduled" && r.scheduled_for && <div className="xs" style={{ fontWeight: 600, color: "var(--info)", margin: "2px 0" }}>{t("Visit {time}", { time: visitTime(r.scheduled_for) })}</div>}
                  <div className="meta">{placeName(r)}{r.unit ? ` · ${r.unit}` : ""} · {ago(r.updated_at) === t("just now") ? t("updated just now") : t("updated {ago} ago", { ago: ago(r.updated_at) })}</div>
                </div>
                <Icon name="chevronRight" width={18} height={18} style={{ color: "var(--muted)", alignSelf: "center" }} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function ResidentRequestPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t } = useT();
  return (
    <>
      <TopBar title={t("Request")} back={() => nav("/r/requests")} />
      <div className="page">
        <Link to="/r/requests" className="btn ghost sm desktop-only" style={{ marginBottom: 12, marginLeft: -8 }}><Icon name="chevronLeft" />{t("My requests")}</Link>
        <RequestDetail id={id!} mode="resident" />
      </div>
    </>
  );
}
