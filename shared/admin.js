// Builds the owner-only admin dashboard from records the app already keeps. Pure function: no database, no network.
//
// Privacy: the dashboard shows account sign-ups and activity (what kind of thing happened, and when), not
// content. It never returns names, full email addresses, photos, descriptions, message text or addresses, so it
// stays within what the privacy policy already promises ("requests are visible only to you and your property's
// managers"; Google sign-in data isn't read by people except for security).

const DAY = 86400e3;

/** "camden@gmail.com" -> "ca••••@gmail.com". Enough to tell accounts apart, not enough to read the address. */
export function maskEmail(email) {
  const e = String(email || "");
  const at = e.lastIndexOf("@");
  if (at < 1) return e ? "•••" : "";
  const local = e.slice(0, at), domain = e.slice(at + 1);
  return `${local.slice(0, Math.min(2, local.length - 1) || 1)}${"•".repeat(4)}@${domain}`;
}

/** Comma-separated ADMIN_EMAILS -> lower-cased list. */
export function parseAdminEmails(raw) {
  return String(raw || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** True only for a signed-in user whose confirmed email is on the admin list. */
export function isAdmin(user, adminEmails) {
  if (!user?.email || !adminEmails?.length) return false;
  const confirmed = !!(user.email_confirmed_at || user.confirmed_at);
  return confirmed && adminEmails.includes(String(user.email).toLowerCase());
}

function signInMethod(u) {
  const p = u.app_metadata?.providers || (u.app_metadata?.provider ? [u.app_metadata.provider] : []);
  const names = p.map((x) => (x === "google" ? "Google" : x === "email" ? "Email" : x));
  return names.length ? names.join(" + ") : "Email";
}

const STATUS = { new: "New", acknowledged: "Seen", scheduled: "Scheduled", in_progress: "In progress", resolved: "Fixed", canceled: "Canceled" };

/**
 * @param {object} d  raw rows: users (auth), profiles, properties, memberships, places (external_places),
 *                    requests, events (request_events), usage (api_usage)
 * @param {number} now
 */
export function buildAdminReport(d, now = Date.now()) {
  const users = d.users || [], profiles = d.profiles || [], properties = d.properties || [], memberships = d.memberships || [];
  const places = d.places || [], requests = d.requests || [], events = d.events || [], usage = d.usage || [];
  const prof = new Map(profiles.map((p) => [p.id, p]));
  const propCreator = new Map(properties.map((p) => [p.id, p.created_by]));
  const reqOwner = new Map(requests.map((r) => [r.id, r.resident_id]));

  const feed = [];
  const push = (user_id, at, type, text) => { if (at) feed.push({ at, user_id: user_id || null, type, text }); };

  for (const u of users) {
    push(u.id, u.created_at, "signup", `Created an account (${signInMethod(u)})`);
    if (u.last_sign_in_at && u.last_sign_in_at !== u.created_at) push(u.id, u.last_sign_in_at, "signin", "Signed in");
  }
  for (const p of properties) push(p.created_by, p.created_at, "property", "Set up a property as a manager");
  for (const m of memberships) {
    if (m.role === "manager" && propCreator.get(m.property_id) === m.user_id) continue; // same moment as setting it up
    push(m.user_id, m.created_at, "join", m.role === "manager" ? "Joined a property as a manager" : "Joined a property as a resident");
  }
  for (const p of places) push(p.user_id, p.created_at, "home", "Added a home whose landlord isn't on CanItWait");
  for (const r of requests) {
    const bits = [r.urgency, r.category, r.has_photo ? "with photo" : "no photo"];
    if (r.after_hours) bits.push("after hours");
    let ai = "";
    if (r.manual_review || !r.ai_urgency) ai = "; AI check unavailable";
    else if (r.ai_urgency !== r.urgency) ai = `; changed the AI's ${r.ai_urgency} to ${r.urgency}`;
    else ai = "; kept the AI's urgency";
    push(r.resident_id, r.created_at, "request", `Sent a request (${bits.filter(Boolean).join(", ")})${ai}`);
  }
  for (const e of events) {
    if (e.kind === "created") continue; // the request row already covers it
    const text = e.kind === "status" ? `Marked a request ${STATUS[e.status] || e.status || "updated"}`
      : e.kind === "message" ? "Sent a message on a request"
      : e.kind === "urgency" ? "Changed a request's urgency"
      : e.kind === "escalated" ? "Emergency escalated to the backup contact"
      : `Request update (${e.kind})`;
    push(e.actor_id || (e.kind === "escalated" ? null : reqOwner.get(e.request_id)), e.created_at, e.kind === "message" ? "message" : "update", text);
  }
  for (const x of usage) push(x.user_id, x.created_at, "ai", x.kind === "triage" ? "Ran an urgency check" : x.kind === "translate" ? "Translated a request" : `Used ${x.kind}`);

  feed.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const lastActive = new Map();
  for (const f of feed) if (f.user_id && !lastActive.has(f.user_id)) lastActive.set(f.user_id, f.at);
  const count = (rows, key, id) => rows.reduce((n, r) => n + (r[key] === id ? 1 : 0), 0);

  const accounts = users.map((u) => {
    const roles = new Set(memberships.filter((m) => m.user_id === u.id).map((m) => m.role));
    if (places.some((p) => p.user_id === u.id)) roles.add("resident");
    return {
      id: u.id,
      short_id: String(u.id).slice(0, 6),
      email: maskEmail(u.email),
      method: signInMethod(u),
      joined: u.created_at,
      last_sign_in: u.last_sign_in_at || null,
      last_active: lastActive.get(u.id) || u.created_at,
      set_up: !!prof.get(u.id)?.onboarded,
      lang: prof.get(u.id)?.lang || "en",
      roles: [...roles].sort(),
      requests: count(requests, "resident_id", u.id),
      checks_24h: usage.filter((x) => x.user_id === u.id && x.kind === "triage").length,
    };
  }).sort((a, b) => (a.joined < b.joined ? 1 : -1));

  const since = (iso, days) => iso && now - new Date(iso).getTime() <= days * DAY;
  const withAI = requests.filter((r) => r.ai_urgency && !r.manual_review);
  const kept = withAI.filter((r) => r.ai_urgency === r.urgency).length;

  return {
    generated_at: new Date(now).toISOString(),
    summary: {
      accounts: users.length,
      new_7d: users.filter((u) => since(u.created_at, 7)).length,
      active_7d: accounts.filter((a) => since(a.last_active, 7)).length,
      set_up: accounts.filter((a) => a.set_up).length,
      properties: properties.length,
      requests: requests.length,
      requests_7d: requests.filter((r) => since(r.created_at, 7)).length,
      checks_24h: usage.filter((x) => x.kind === "triage").length,
      ai_kept_rate: withAI.length ? Math.round((100 * kept) / withAI.length) : null,
      ai_judged: withAI.length,
    },
    accounts,
    feed: feed.slice(0, 300),
  };
}
