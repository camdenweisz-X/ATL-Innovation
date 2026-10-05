# CanItWait

Team: The InnovAItors (ATL Cup 2026)

CanItWait helps renters report maintenance problems and helps property managers handle them. A renter takes a photo and types a few words. The app says whether it's an Emergency, Urgent, or Routine, explains why, gives safe steps until it's fixed, and drafts the request. The manager gets an inbox with emergencies at the top, and both sides follow the request's status and messages in one place. Everything works in English and Spanish.

**Setup instructions are in [SETUP.md](SETUP.md).**

## What's in it

**Renters**
- Create an account (email or Google), then join your property with a code from your manager, or add a home whose landlord isn't on CanItWait.
- Report a problem: photo and/or a short video (up to 60 seconds), description, where in the home, and quick safety questions. Any "yes" to a safety question makes it an emergency, no matter what the AI says. If the description mentions gas, smoke, flooding, a CO alarm or a door that won't lock (English or Spanish), the app asks about it even when the AI didn't.
- Review the AI's urgency call and the drafted request, change anything, and add access details (permission to enter, pets, gate/lockbox/parking notes, best times). Access answers are remembered per home on the phone.
- Missing details in [brackets]? Tapping Send asks each one as a question and fills the answers into the message.
- Emergencies show one-tap buttons for 911, Atlanta Gas Light and the property's after-hours line, and stay on screen until the manager acknowledges.
- Send it. CanItWait properties get it in their inbox; outside landlords get it by your own email or text app.
- Track every request: status timeline and messages with maintenance. Save a timestamped record of any request (or all of them) as a PDF.
- More than one home? Add each one and pick which home when you report.

**Managers**
- Create properties and share a resident code or invite link.
- Inbox sorted by urgency with counts, filters by property and status, photos, unit, entry permission, and how long each request has waited.
- Updates live as requests come in. A red banner and an alarm sound show any emergency nobody has acknowledged.
- Emergencies reach every manager by phone notification, email and (optional) text. If nobody acknowledges within the property's delay, the backup contact is texted and emailed and the resident is told to call.
- Work orders: acknowledge, schedule a visit (time, technician, note to the resident), start work, mark fixed and record whether it took one visit. Correct the urgency with a reason; every change is logged.
- Requests or messages in another language: one-tap Translate.
- Works alongside other software: CSV export, "Copy as work order", and automatic forwarding of new requests to an email address (for example an AppFolio or Buildium maintenance inbox).
- Repeat alerts: the same unit reporting the same kind of problem twice in 60 days, and 3+ units reporting the same problem within a week (possibly building-wide).
- Insights: after-hours reports that could wait (with a savings estimate from your own call-out cost), emergency response time, time to fix, first-visit fix rate, complete-on-arrival rate, AI accuracy (matched, too low, too high, and why your team changed it), and requests by category.
- Sample data: one tap loads a separate sample property with six weeks of history for demos. Delete it when you're done.
- Invite co-managers with a separate team code. See residents, remove people, and create new codes if one leaks.

**Everyone**
- English or Español, picked at sign-in or in Settings. The AI, emails and notifications follow it.
- Settings for name and phone, password, homes and properties, phone notifications, email updates, emergency texts, light or dark mode, sign out, and delete account.
- One account per email: signing up again with the right password just signs you in; Google sign-in joins the existing account.
- If someone is both a renter and a manager, they can switch between the two views.

## How it's built

| Part | Tool |
|---|---|
| App | React + TypeScript, built with Vite (`src/`) |
| Database, accounts, photos, live updates | Supabase (`supabase/migrations/0001_canitwait.sql`) |
| AI urgency check and translation | Google Gemini, called from `api/triage.js` and `api/translate.js` |
| Emails, phone notifications, texts | Resend, Web Push and Twilio, from `api/notify.js` and `api/escalate.js` (each optional) |
| Emergency escalation | Supabase pg_cron calls `api/escalate.js` every minute (`supabase/cron.sql`) |
| Spanish | `shared/i18n.js` and `shared/es.js`; `tests/i18n.test.js` fails if a string has no Spanish |
| Hosting | Vercel (the page plus the `api/` functions) |

The urgency rules, danger words and the AI prompt are in `shared/triage.js`, used by both the app and the server. Repeat-alert and Insights math is in `shared/workorders.js`; CSV and work-order formats are in `shared/exports.js`.

## Folders

```
src/
  auth/            sign in, sign up, password reset, join links
  onboarding/      first-run setup
  resident/        report flow, my requests
  manager/         inbox, properties and team
  settings/        settings and homes
  shared-screens/  request detail, printable record, place and property forms
  ui/              buttons, fields, sheets, icons
  lib/             Supabase client, session, API calls, helpers
api/               serverless functions (AI check, translation, notifications, escalation, account deletion, health)
shared/            urgency rules, AI prompt, translations, exports
supabase/          database schema, escalation schedule and access-rule tests
tests/             server function tests
```

The original single-file prototype (v1.4, submitted for Mission 5) and its v1.5 update are in the git history; v1.5's work orders, repeat alerts and Insights are carried into this version.
