# FixCheck

Team: The InnovAItors (ATL Cup 2026, Mission 5)

FixCheck is for apartment renters in metro Atlanta. When something breaks, you take a photo and type a few words. The app tells you if it's an Emergency, Urgent, or Routine, writes up the maintenance request, and helps you send it.

## How it works

**Renters**
1. Open the app and pick "I rent an apartment."
2. Enter your first name and unit. Choose how requests get sent: by your own email/text, or to your property's FixCheck inbox (needs a code from your manager).
3. Add a photo, describe the problem, and answer the quick safety questions.
4. Tap **Check urgency**. The AI looks at the photo and description and gives you:
   - the urgency level and why
   - what to do until it's fixed
   - a drafted request you can edit
   - questions maintenance will probably ask
5. Change anything you want, then send it. Past requests show up under **My requests**.

**Managers**
1. Pick "I manage a property."
2. Enter the property name. You get a code like `FC-PEAC-7K3Q` to give to residents.
3. Requests from residents who used your code show up in your inbox, emergencies first.
4. Track each request as a work order: **Mark seen**, **Schedule visit** (time, technician, note to the resident), and **Mark fixed** (with "fixed on the first visit?"). You can also change the urgency if FixCheck got it wrong. Residents see the status and your note under **My requests**.
5. **Repeat-problem alerts** appear at the top of the inbox: the same unit reporting the same kind of problem twice in 60 days, and 3 or more units reporting the same problem within 7 days (a possible building-wide issue). Tap **Show** to see those requests.
6. The **Insights** tab shows what FixCheck is saving you: after-hours reports that could wait until morning (and an estimated dollar amount once you enter your own call-out cost), time to first response on emergencies, time to fix, first-visit fix rate, how many requests arrived complete, and how often your team kept FixCheck's urgency.
7. For demos, **Load sample data** fills the inbox with 16 example requests. They stay on that device and can be removed anytime.

**Safety rules that don't depend on the AI**
- Answering "Yes" to any safety question (gas smell, smoke, water you can't stop, CO alarm, door won't lock) always makes it an Emergency.
- If the AI is down or gives a bad answer, you can still fill out a basic form and send it. It gets marked for manual review.

## Setup (Vercel, free)

1. Put this code in a GitHub repo. `vercel.json`, `public/`, and `api/` need to be at the top level.
2. Go to vercel.com, log in with GitHub, click **Add New → Project**, and import the repo. Framework: **Other**.
3. Under **Environment Variables**, add `GEMINI_API_KEY` with your key from aistudio.google.com/apikey.
4. Click **Deploy**. Open the link it gives you on your phone.

Every time you commit to GitHub, Vercel redeploys on its own. The version number is in the app's footer.

If the AI check fails, open your project in Vercel and check **Logs**. Lines starting with `Gemini ... error` tell you why. Usually it's a missing key (add it and redeploy) or the free limit (wait a minute).

## Where the API key goes

Only in Vercel's environment variables. The browser never sees it, and it should never be put in the code or committed to GitHub.

## Files

| File | What it is |
|---|---|
| `src/app.html` | The whole app. Edit this one. |
| `build.js` | Run `node build.js` after editing. It creates `public/index.html` and `lib/shared.js`. |
| `public/index.html` | The page Vercel serves (generated) |
| `api/triage.js` | The server function that calls Gemini |
| `lib/shared.js` | The AI prompt and answer checks (generated) |
| `server.js` | Run the app on your own computer |
| `test/triage.test.js` | AI call tests, no key needed |
| `test/insights.test.js` | Work order, repeat alert and Insights tests. Run all tests with `npm test` |

## Run it on your computer

```
node build.js
GEMINI_API_KEY=your-key node server.js
```

Then open http://localhost:3000.


