# FixCheck — The InnovAItors (ATL Cup 2026, Mission 5)

For **apartment residents in metro Atlanta**, when **something in their unit breaks, often after hours**, FixCheck lets them **snap a photo, add a few words, and get an AI urgency call plus a drafted maintenance request** so they can **send a complete request at the right urgency and know whether to call now or go to bed**.

## Deploy to Vercel (free, ~10 minutes)

1. Push this folder's contents to the **root** of the GitHub repo (`vercel.json`, `public/`, `api/` must sit at the top level).
2. vercel.com → sign in with GitHub → **Add New → Project** → import the repo.
   - Framework Preset: **Other**. Leave Build and Output settings as they are (`vercel.json` sets them).
3. Before clicking Deploy, open **Environment Variables** and add:
   - `GEMINI_API_KEY` = your key from aistudio.google.com/apikey
4. **Deploy.** Open the `*.vercel.app` link on a phone and run one report end to end.
5. If the AI check fails: Vercel project → **Logs** (or Deployments → the deployment → Functions). Lines starting `Gemini ... error` show Google's reason. Common ones: 400/403 = key wrong or not set (redeploy after adding the variable), 429 = free-tier limit hit, wait a minute.

Changing the key later: update the variable in Vercel → Settings → Environment Variables, then **Redeploy**.

### Where the API key lives

Only in Vercel's server environment. `api/triage.js` reads `process.env.GEMINI_API_KEY` and sends it to Google in a request header. The browser only ever talks to `/api/triage` and never sees the key. The key is not in this repo; `.env` is git-ignored.

## The one core task

1. **Entry** – Resident opens the app. First run only: first name, unit, community, optional after-hours line and manager email (saved on the phone).
2. **Action** – Photo + a few words + optional 5-question safety check → **Check urgency**.
3. **AI function** – one call to Gemini (Flash). Input: photo, description, safety-check answers, current local time. Output (JSON): urgency (Emergency / Urgent / Routine), one-sentence reason, safety message, 1–2 "until it's fixed" steps, category, title, drafted request with `[bracketed blanks]` for missing facts, up to 4 technician questions, photo notes.
4. **Resident control** – change urgency (manager sees "Resident changed from X"), category, title, edit the message, answer the questions. Nothing sends until the resident taps **Send**.
5. **Result** – request lands in the **Manager inbox** sorted Emergency → Urgent → Routine, with photo, unit, category, AI reason. Resident sees "Call now" / "You can go to bed" / "All set" plus a copyable request.

**Failure / help paths:** no photo or text → prompt; any "Yes" on the safety check → forced Emergency (rule, not AI, enforced in page and server); Emergency → red safety panel with 911 / Atlanta Gas Light / after-hours line; AI unreachable, stopped, busy or malformed reply → basic form, request flagged **Manual review**; first model busy → server retries a second free model; leftover `[blanks]` → warning before send; inbox unreachable → copy the request and text/email it.

## Code map

| File | What it is |
|---|---|
| `src/app.html` | **Single source** for the app (UI, prompt, output checker). Edit this. |
| `build.js` | `node build.js` → generates `public/index.html`, `lib/shared.js`, `artifact.html` |
| `public/index.html` | The page Vercel serves (generated) |
| `api/triage.js` | Vercel serverless function: the Gemini call. Holds the key server-side. |
| `lib/shared.js` | Generated: urgency prompt + output checker, shared by page and API |
| `server.js` | Zero-dependency local server for testing |
| `test/triage.test.js` | Offline tests (no key, no network) |

## Run locally

```bash
node build.js
GEMINI_API_KEY=your-key node server.js     # http://localhost:3000
node test/triage.test.js                    # no key needed
```

Optional: `GEMINI_MODEL=gemini-3.8-flash,gemini-3.5-flash-lite` sets which models to try, in order.

## Known limits

- The hosted manager inbox is a **demo inbox stored in the browser of the phone that sent the request**. Good for an in-person test on one phone; not shared across devices yet.
- Gemini free tier: Google may use submitted content to improve its products, so testers should not type full names, addresses or phone numbers. The app only asks for a first name and unit.
- `artifact.html` is an alternate build that runs inside claude.ai; it is not needed for the Vercel deployment.
