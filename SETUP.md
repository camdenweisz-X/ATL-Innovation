# Setting up CanItWait

Everything here runs on free plans: Supabase (database, accounts, photos), Vercel (hosting), Google Gemini (AI), and optionally Resend (email). Plan on about 30 minutes the first time.

You'll collect these values along the way:

| Name | Where it comes from | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | No |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key | No (it's meant to be public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key | **Yes. Never put it in the code or share it.** |
| `GEMINI_API_KEY` | aistudio.google.com/apikey | **Yes** |
| `APP_URL` | Your Vercel address, like `https://atl-innovation.vercel.app` | No |
| `RESEND_API_KEY`, `RESEND_FROM` | resend.com (optional, for email) | Key is secret |

---

## 1. Create the database (Supabase)

1. Go to supabase.com, sign up, and create a new project. Pick a strong database password and save it somewhere. Choose the US East region.
2. When the project is ready, open **SQL Editor**, click **New query**, paste the whole file `supabase/migrations/0001_canitwait.sql`, and click **Run**. It should finish with "Success. No rows returned". It's safe to run again later if the file changes.
3. Open **Project Settings → API** and copy the Project URL, the `anon` key and the `service_role` key.

## 2. Set up sign-in (Supabase → Authentication)

1. **URL configuration:** set **Site URL** to your Vercel address (step 4 gives you this; come back if you don't have it yet). Under **Redirect URLs** add:
   - `https://YOUR-APP.vercel.app/**`
   - `http://localhost:5173/**` (for running it on your computer)
2. **Email confirmation (important):** Supabase's built-in email sender only sends 2 emails an hour, and only to members of your Supabase team. For internal testing, pick one:
   - **Easiest:** turn off **Confirm email** under the Email provider settings. People can sign up and use the app right away.
   - **Proper:** set up Resend (step 5) and enter it under **Authentication → Emails → SMTP settings**. Then leave Confirm email on.
3. **Google sign-in (optional):**
   1. In Google Cloud Console, go to **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
   2. Under **Authorized JavaScript origins** add your Vercel address and `http://localhost:5173`.
   3. Under **Authorized redirect URIs** add the callback URL shown on Supabase's Google provider page. It looks like `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
   4. Copy the client ID and secret into **Supabase → Authentication → Providers → Google**, and turn it on.

   Until this is done, the "Continue with Google" button tells people to use email instead.

## 3. Get the AI key (Google Gemini)

Go to aistudio.google.com/apikey and create a key. The free tier is enough for testing. On the free tier Google may use what's sent to improve its products; the app's privacy note tells users this.

## 4. Deploy (Vercel)

1. Push this repo to GitHub.
2. On vercel.com, open your existing project (or **Add New → Project** and import the repo). The included `vercel.json` sets the framework to Vite and the output to `dist`, so leave the build settings alone.
3. **Settings → Environment Variables:** add every value from the table above (skip Resend for now if you like). Apply them to Production and Preview.
4. **Deployments → Redeploy** so the new variables take effect.
5. Open the site. If you see "CanItWait isn't connected yet", the two `VITE_SUPABASE_...` variables are missing or need a redeploy.

## 5. Email notifications (optional, Resend)

1. Sign up at resend.com and create an API key.
2. To email anyone other than yourself, Resend needs a **domain you own**, verified with a few DNS records. Without one, Resend only delivers to your own Resend account email.
3. Set `RESEND_API_KEY` and `RESEND_FROM` (for example `CanItWait <notifications@yourdomain.com>`) in Vercel and redeploy.
4. Use the same domain for Supabase sign-up emails: in Supabase SMTP settings, use host `smtp.resend.com`, port `465`, user `resend`, and your Resend API key as the password.

Without Resend, everything still works; people just see updates in the app instead of getting emails.

## 6. Try it end to end

Fastest demo: create a manager account, add any property, then tap **Load sample data** on the Properties screen. You get a separate sample property with six weeks of requests, repeat alerts and a filled-in Insights screen. Delete it from Properties when you're done.

To test the full flow with two people:

1. Create a manager account. Choose **I manage properties** and add a property. Copy the resident code from **Properties**.
2. In a private browser window (or on your phone), create a resident account. Choose **I rent a home** and enter the code and a unit.
3. As the resident, take a photo, describe a problem, tap **Check urgency**, review it, and send it.
4. As the manager, the request appears in the Inbox without refreshing. Mark it scheduled with a note, and send a message.
5. As the resident, open **Requests**. The status and message are there.

## Running it on your computer

```bash
npm install
cp .env.example .env.local      # fill in the VITE_ values
npm run dev                     # http://localhost:5173
```

The AI check calls `/api/triage`, which only exists on Vercel. To test it locally, install the Vercel CLI and run `vercel dev` instead of `npm run dev`.

## Tests

```bash
npm test          # server, Insights math and 64 database access-rule tests (no keys needed)
npm run build     # type check and production build
```

## Free-tier limits to know

- **Supabase:** a free project **pauses after a week with no activity**. Open the dashboard and click Restore to wake it. Limits are 500 MB of data, 1 GB of photos and 200 people connected live at once.
- **Gemini:** Google doesn't publish exact free limits; they're shown in AI Studio. The app allows each person 15 checks per 10 minutes, and falls back to a second model when the first is busy.
- **Resend:** 100 emails a day, 3,000 a month.
- **Vercel Hobby:** for non-commercial use. Uploads to the server are capped at 4.5 MB, which is why photos are shrunk on the phone first.

## Security notes

- Row Level Security is on for every table. Residents see only their own requests; managers see only requests for properties they manage. `supabase/tests/rls.test.mjs` checks 64 of these rules.
- The service-role key and Gemini key live only in Vercel's server environment.
- The AI result is attached by the resident's app. A technical user could edit the "AI check" text before sending. Treat it as the resident's report, not a verified record.
- Photos of deleted properties stay in storage until removed in the Supabase dashboard. Deleting an account removes that person's photos.
