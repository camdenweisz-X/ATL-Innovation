// POST /api/triage — the one AI call in FixCheck (hosted mode), using Google's Gemini API.
// Input  JSON: { description, checklist:{gas,fire,water,co,lock: "yes"|"no"}, localTime, afterHours, image?:{mediaType,data(base64)} }
// Output JSON: { urgency, reason, safety_message, until_fixed[], category, title, request, questions[], photo_notes }
//
// The API key lives ONLY in the GEMINI_API_KEY environment variable on the server (Vercel → Settings →
// Environment Variables). It is never sent to the browser and never committed to the repo.
"use strict";
const { buildPrompt, normalizeAI, SAFETY_QS } = require("../lib/shared.js");

// Free-tier Flash models that read photos. If the first is busy or unavailable, the next one is tried.
const MODELS = (process.env.GEMINI_MODEL || "gemini-3.8-flash,gemini-3.5-flash-lite")
  .split(",").map(s => s.trim()).filter(Boolean);
const MAX_DESC = 2000;
const MAX_IMAGE_B64 = 6 * 1024 * 1024; // ~4.5 MB image
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function parseModelJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

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
    // Log status + Google's message for debugging in Vercel's function logs (never the key).
    console.error(`Gemini ${model} error ${r.status}: ${detail.slice(0, 400)}`);
    return { status: r.status };
  }
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  return { status: 200, text, blocked: !text && (data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason) };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  if (!process.env.GEMINI_API_KEY) return send(res, 503, { error: "Server has no GEMINI_API_KEY set" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== "object") return send(res, 400, { error: "Expected a JSON body" });

  const description = String(body.description || "").slice(0, MAX_DESC);
  const checklist = {};
  for (const s of SAFETY_QS) { const v = body.checklist?.[s.k]; if (v === "yes" || v === "no") checklist[s.k] = v; }
  const localTime = String(body.localTime || new Date().toISOString()).slice(0, 60);
  const afterHours = !!body.afterHours;

  let image = null;
  if (body.image && typeof body.image.data === "string") {
    if (!IMAGE_TYPES.includes(body.image.mediaType)) return send(res, 400, { error: "Unsupported image type" });
    if (body.image.data.length > MAX_IMAGE_B64) return send(res, 413, { error: "Image too large" });
    image = { inline_data: { mime_type: body.image.mediaType, data: body.image.data } };
  }
  if (!description && !image) return send(res, 400, { error: "Add a description or a photo" });

  const prompt = buildPrompt({ description, checklist, localTime, afterHours, hasPhoto: !!image });
  const parts = image ? [image, { text: prompt }] : [{ text: prompt }];

  try {
    let lastStatus = 502;
    for (const model of MODELS) {
      const out = await askGemini(model, parts);
      if (out.status === 200) {
        if (out.blocked) return send(res, 502, { error: "AI declined this report" });
        let result;
        try { result = normalizeAI(parseModelJSON(out.text)); } catch { return send(res, 502, { error: "AI reply was malformed" }); }
        // Safety floor enforced on the server too: any "yes" on the checklist means Emergency.
        if (Object.values(checklist).includes("yes")) result.urgency = "Emergency";
        return send(res, 200, result);
      }
      lastStatus = out.status;
      // Try the next model only when this one is missing, busy, or down. A bad key or bad request won't improve.
      if (![404, 429, 500, 503].includes(out.status)) break;
    }
    return send(res, lastStatus === 429 ? 429 : 502, { error: lastStatus === 429 ? "AI is busy" : "AI request failed" });
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: "AI request failed" });
  }
};
