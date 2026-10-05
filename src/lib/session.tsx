import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, configured } from "./supabase";
import { local } from "./store";
import type { ExternalPlace, Membership, Place, Profile, Property } from "./types";

export type Workspace = "resident" | "manager";

interface Ctx {
  ready: boolean;
  /** True while the signed-in person's profile and memberships are loading. */
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  memberships: Membership[];
  externalPlaces: ExternalPlace[];
  /** Places this person can report for, as a resident. */
  places: Place[];
  /** Properties this person manages. */
  managed: Property[];
  workspace: Workspace;
  setWorkspace: (w: Workspace) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside provider");
  return c;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!configured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [externalPlaces, setExternal] = useState<ExternalPlace[]>([]);
  const [workspace, setWs] = useState<Workspace>(local.get<Workspace>("fc_workspace", "resident"));
  const [loading, setLoading] = useState(false);

  const userId = useRef<string | null>(null);
  /** `quiet` refreshes data in place; otherwise the app shows a loading screen until it's ready. */
  const load = useCallback(async (s: Session | null, quiet = false) => {
    userId.current = s?.user.id ?? null;
    if (!s) { setProfile(null); setMemberships([]); setExternal([]); setLoading(false); return; }
    if (!quiet) setLoading(true);
    const uid = s.user.id;
    const [p, m, e] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("memberships").select("*, property:properties(*)").eq("user_id", uid).order("created_at"),
      supabase.from("external_places").select("*").eq("user_id", uid).order("created_at"),
    ]);
    setProfile((p.data as Profile) || { id: uid, full_name: "", phone: null, notify_email: true, onboarded: false });
    setMemberships((m.data as Membership[]) || []);
    setExternal((e.data as ExternalPlace[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await load(data.session);
      if (alive) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Reload data when the person changes, not on every token refresh.
      if (event === "SIGNED_OUT" || (s && userId.current !== s.user.id)) void load(s);
      else if (event === "USER_UPDATED") void load(s, true);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [load]);

  const places = useMemo<Place[]>(() => {
    const out: Place[] = [];
    for (const m of memberships) if (m.role === "resident" && m.property) {
      out.push({ kind: "property", key: "m:" + m.id, membership: m, property: m.property, label: m.property.name, unit: m.unit });
    }
    for (const e of externalPlaces) out.push({ kind: "external", key: "e:" + e.id, place: e, label: e.label, unit: e.unit });
    return out;
  }, [memberships, externalPlaces]);

  const managed = useMemo(() => memberships.filter((m) => m.role === "manager" && m.property).map((m) => m.property!) , [memberships]);

  // Pick a sensible workspace when someone only has one role.
  const effectiveWs: Workspace = managed.length && !places.length ? "manager" : places.length && !managed.length ? "resident" : workspace;

  const value: Ctx = {
    ready, loading, session, user: session?.user ?? null, profile, memberships, externalPlaces, places, managed,
    workspace: effectiveWs,
    setWorkspace: (w) => { local.set("fc_workspace", w); setWs(w); },
    refresh: () => load(session, true),
    signOut: async () => {
      await supabase.auth.signOut();
      for (const k of ["fc_draft", "fc_review", "fc_join", "fc_last_place", "fc_workspace"]) local.del(k);
    },
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
