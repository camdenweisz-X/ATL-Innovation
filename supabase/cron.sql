-- Emergency escalation: checks every minute for emergencies nobody has acknowledged.
-- Uses Supabase's built-in pg_cron and pg_net (free plan included).
--
-- Before running:
--   1. Replace https://YOUR-APP.vercel.app with your app's address (for example https://canitwait.net).
--   2. Replace YOUR-CRON-SECRET with the same long random value you set as CRON_SECRET in Vercel.
-- Then paste into Supabase → SQL Editor → Run. Running it again updates the schedule.
-- To stop it: select cron.unschedule('canitwait-escalate');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'canitwait-escalate',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/escalate',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR-CRON-SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
