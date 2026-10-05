# FixCheck

Team: The InnovAItors (ATL Cup 2026)

FixCheck helps renters report maintenance problems and helps property managers handle them. A renter takes a photo and types a few words. The app says whether it's an Emergency, Urgent, or Routine, explains why, gives safe steps until it's fixed, and drafts the request. The manager gets an inbox with emergencies at the top, and both sides follow the request's status and messages in one place.

**Setup instructions are in [SETUP.md](SETUP.md).**

## What's in it

**Renters**
- Create an account (email or Google), then join your property with a code from your manager, or add a home whose landlord isn't on FixCheck.
- Report a problem: photo, description, where in the home, and quick safety questions. Any "yes" to a safety question makes it an emergency, no matter what the AI says.
- Review the AI's urgency call and the drafted request, change anything, and add access details (permission to enter, pets, best times).
- Send it. FixCheck properties get it in their inbox; outside landlords get it by your own email or text app.
- Track every request: status timeline and messages with maintenance.
- More than one home? Add each one and pick which home when you report.

**Managers**
- Create properties and share a resident code or invite link.
- Inbox sorted by urgency with counts, filters by property and status, photos, unit, entry permission, and how long each request has waited.
- Updates live as requests come in. Change status (seen, scheduled, in progress, fixed) with a note, and message the resident.
- Invite co-managers with a separate team code. See residents, remove people, and create new codes if one leaks.

**Everyone**
- Settings for name and phone, password, homes and properties, email updates, light or dark mode, sign out, and delete account.
- If someone is both a renter and a manager, they can switch between the two views.

## How it's built

| Part | Tool |
|---|---|
| App | React + TypeScript, built with Vite (`src/`) |
| Database, accounts, photos, live updates | Supabase (`supabase/migrations/0001_fixcheck.sql`) |
| AI urgency check | Google Gemini, called from `api/triage.js` |
| Emails | Resend, called from `api/notify.js` (optional) |
| Hosting | Vercel (the page plus the `api/` functions) |

The urgency rules and the AI prompt are in `shared/triage.js`, used by both the app and the server.

## Folders

```
src/
  auth/            sign in, sign up, password reset, join links
  onboarding/      first-run setup
  resident/        report flow, my requests
  manager/         inbox, properties and team
  settings/        settings and homes
  shared-screens/  request detail, place and property forms
  ui/              buttons, fields, sheets, icons
  lib/             Supabase client, session, API calls, helpers
api/               serverless functions (AI check, emails, account deletion)
shared/            urgency rules and AI prompt
supabase/          database schema and access-rule tests
tests/             server function tests
```

The original single-file prototype (v1.4, submitted for Mission 5) is in the git history.
