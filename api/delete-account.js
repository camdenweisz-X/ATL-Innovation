// POST /api/delete-account — permanently deletes the signed-in user's account.
// Removes their photos, deletes properties where they are the only manager, then deletes the auth user
// (which cascades to profile, memberships, requests and messages).
import { send, getUser, adminClient } from "./_lib/server.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  const user = await getUser(req);
  if (!user) return send(res, 401, { error: "Sign in first" });
  const admin = adminClient();
  if (!admin) return send(res, 503, { error: "Account deletion isn't configured on the server (SUPABASE_SERVICE_ROLE_KEY)." });

  try {
    // 1. Properties where this person is the only manager go with them.
    const { data: mine } = await admin.from("memberships").select("property_id").eq("user_id", user.id).eq("role", "manager");
    for (const { property_id } of mine || []) {
      const { count } = await admin.from("memberships").select("id", { count: "exact", head: true }).eq("property_id", property_id).eq("role", "manager");
      if ((count || 0) <= 1) await admin.from("properties").delete().eq("id", property_id);
    }
    // 2. Their photos.
    for (;;) {
      const { data: files } = await admin.storage.from("request-photos").list(user.id, { limit: 100 });
      if (!files?.length) break;
      await admin.storage.from("request-photos").remove(files.map((f) => `${user.id}/${f.name}`));
      if (files.length < 100) break;
    }
    // 3. The account itself.
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
    return send(res, 200, { deleted: true });
  } catch (e) {
    console.error("delete-account", e);
    return send(res, 500, { error: "Couldn't delete the account. Try again, or contact support." });
  }
}
