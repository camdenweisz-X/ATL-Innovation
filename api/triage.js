// POST /api/triage — the AI urgency check. Signed-in users only.
// Body: { description, checklist, localTime, afterHours, locationInHome?, image?: { mediaType, data(base64) } }
// The Gemini key lives only in the server environment (GEMINI_API_KEY).
import { buildPrompt, normalizeAI, parseModelJSON, SAFETY_QS } from "../shared/triage.js";
import { send, readJSON, getUser, rateLimited } from "./_lib/server.js";

const MODELS = (process.env.GEMINI_MODEL || "gemini-3.8-flash,gemini-3.5-flash-lite").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_DESC = 2000;
const MAX_IMAGE_B64 = 4 * 1024 * 1024; // keeps the whole request under Vercel's 4.5 MB body limit
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function askGemini(model, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 4096 },
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error(`Gemini ${model} error ${r.status}: ${detail.slice(0, 400)}`);
    return { status: r.status };
  }
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return { status: 200, text, blocked: !text };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  if (!process.env.GEMINI_API_KEY) return send(res, 503, { error: "AI is not configured on the server" });

  const user = await getUser(req);
  if (!user) return send(res, 401, { error: "Sign in to use the urgency check" });
  if (await rateLimited(user.id, "triage", 15, 10 * 60 * 1000)) return send(res, 429, { error: "Too many checks. Try again in a few minutes." });

  const body = await readJSON(req);
  if (!body || typeof body !== "object") return send(res, 400, { error: "Expected a JSON body" });

  const description = String(body.description || "").slice(0, MAX_DESC);
  const checklist = {};
  for (const s of SAFETY_QS) { const v = body.checklist?.[s.k]; if (v === "yes" || v === "no") checklist[s.k] = v; }
  const localTime = String(body.localTime || new Date().toISOString()).slice(0, 60);
  const locationInHome = String(body.locationInHome || "").slice(0, 60);

  let image = null;
  if (body.image && typeof body.image.data === "string") {
    if (!IMAGE_TYPES.includes(body.image.mediaType)) return send(res, 400, { error: "Unsupported image type" });
    if (body.image.data.length > MAX_IMAGE_B64) return send(res, 413, { error: "Image too large" });
    image = { inline_data: { mime_type: body.image.mediaType, data: body.image.data } };
  }
  if (!description && !image) return send(res, 400, { error: "Add a description or a photo" });

  const prompt = buildPrompt({ description, checklist, localTime, afterHours: !!body.afterHours, hasPhoto: !!image, locationInHome });
  const parts = image ? [image, { text: prompt }] : [{ text: prompt }];

  try {
    let last = 502;
    for (const model of MODELS) {
      const out = await askGemini(model, parts);
      if (out.status === 200) {
        if (out.blocked) return send(res, 502, { error: "AI declined this report" });
        let result;
        try { result = normalizeAI(parseModelJSON(out.text)); } catch { return send(res, 502, { error: "AI reply was malformed" }); }
        if (Object.values(checklist).includes("yes")) result.urgency = "Emergency"; // rule, not AI
        return send(res, 200, result);
      }
      last = out.status;
      if (![404, 429, 500, 503].includes(out.status)) break; // a bad key or bad request won't improve on another model
    }
    return send(res, last === 429 ? 429 : 502, { error: last === 429 ? "AI is busy" : "AI request failed" });
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: "AI request failed" });
  }
}
