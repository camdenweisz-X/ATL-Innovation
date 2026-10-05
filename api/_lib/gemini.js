// Google Gemini calls shared by the AI urgency check and translation.
export const MODELS = (process.env.GEMINI_MODEL || "gemini-3.8-flash,gemini-3.5-flash-lite").split(",").map((s) => s.trim()).filter(Boolean);

export async function askGemini(model, parts, { temperature = 0.2, maxOutputTokens = 4096 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": String(process.env.GEMINI_API_KEY || "").trim() },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature, maxOutputTokens },
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
