-- CanItWait database: run this once in Supabase → SQL Editor (or `supabase db push`).
-- Everything is protected by Row Level Security: people only see what their memberships allow.
--
-- Model
--   profiles          one per account (name, phone, notification setting)
--   properties        a building/community a manager runs
--   property_codes    join codes (resident code + co-manager code); readable by managers only
--   memberships       who belongs to which property, as 'manager' or 'resident' (+ unit)
--   external_places   a renter's place whose landlord isn't on CanItWait (requests go by email/text)
--   requests          maintenance requests
--   request_events    timeline: created, status changes, messages

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- types
do $$ begin
  create type public.member_role as enum ('manager', 'resident');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.urgency_level as enum ('Emergency', 'Urgent', 'Routine');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.request_status as enum ('new', 'acknowledged', 'scheduled', 'in_progress', 'resolved', 'canceled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null default '' check (char_length(full_name) <= 80),
  phone         text check (phone is null or char_length(phone) <= 30),
  notify_email  boolean not null default true,
  onboarded     boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.properties (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 1 and 120),
  address            text check (address is null or char_length(address) <= 200),
  after_hours_phone  text check (after_hours_phone is null or char_length(after_hours_phone) <= 30),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now()
);

create table if not exists public.property_codes (
  property_id    uuid primary key references public.properties (id) on delete cascade,
  resident_code  text not null unique,
  manager_code   text not null unique,
  rotated_at     timestamptz not null default now()
);

create table if not exists public.memberships (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.member_role not null,
  unit         text check (unit is null or char_length(unit) <= 40),
  created_at   timestamptz not null default now(),
  unique (property_id, user_id, role)
);
create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_property_idx on public.memberships (property_id, role);

create table if not exists public.external_places (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label              text not null check (char_length(label) between 1 and 80),
  unit               text check (unit is null or char_length(unit) <= 40),
  contact_name       text check (contact_name is null or char_length(contact_name) <= 80),
  contact_email      text check (contact_email is null or char_length(contact_email) <= 120),
  contact_phone      text check (contact_phone is null or char_length(contact_phone) <= 30),
  after_hours_phone  text check (after_hours_phone is null or char_length(after_hours_phone) <= 30),
  created_at         timestamptz not null default now(),
  check (contact_email is not null or contact_phone is not null)
);
create index if not exists external_places_user_idx on public.external_places (user_id);

create table if not exists public.requests (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique default ('CW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  resident_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  property_id        uuid references public.properties (id) on delete cascade,
  external_place_id  uuid references public.external_places (id) on delete set null,
  unit               text check (unit is null or char_length(unit) <= 40),
  title              text not null check (char_length(title) between 1 and 120),
  category           text not null check (char_length(category) <= 40),
  urgency            public.urgency_level not null,
  ai_urgency         public.urgency_level,
  ai_reason          text check (ai_reason is null or char_length(ai_reason) <= 500),
  safety_flags       text[] not null default '{}',
  description        text check (description is null or char_length(description) <= 2000),
  body               text not null check (char_length(body) between 1 and 4000),
  answers            jsonb not null default '[]'::jsonb,
  location_in_home   text check (location_in_home is null or char_length(location_in_home) <= 60),
  entry_permission   boolean,
  entry_notes        text check (entry_notes is null or char_length(entry_notes) <= 300),
  has_pets           boolean,
  availability       text check (availability is null or char_length(availability) <= 200),
  photo_path         text,
  manual_review      boolean not null default false,
  status             public.request_status not null default 'new',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (property_id is not null or external_place_id is not null)
);
create index if not exists requests_property_idx on public.requests (property_id, status, created_at desc);
create index if not exists requests_resident_idx on public.requests (resident_id, created_at desc);

create table if not exists public.request_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests (id) on delete cascade,
  actor_id    uuid default auth.uid() references auth.users (id) on delete set null,
  kind        text not null check (kind in ('created', 'status', 'message')),
  status      public.request_status,
  body        text check (body is null or char_length(body) <= 2000),
  notified_at timestamptz,            -- set by the server after it emails about this event (prevents repeat emails)
  created_at  timestamptz not null default now()
);
alter table public.request_events add column if not exists notified_at timestamptz;
create index if not exists request_events_request_idx on public.request_events (request_id, created_at);

-- Work orders (visit scheduling, first-visit fixes, manager urgency changes) and Insights inputs.
alter table public.requests add column if not exists after_hours boolean not null default false;
alter table public.requests add column if not exists blanks_left int not null default 0;
alter table public.requests add column if not exists has_photo boolean not null default false;
alter table public.requests add column if not exists scheduled_for timestamptz;
alter table public.requests add column if not exists tech text;
alter table public.requests add column if not exists first_visit boolean;
alter table public.requests add column if not exists mgr_urgency public.urgency_level;
alter table public.requests drop constraint if exists requests_tech_len;
alter table public.requests add constraint requests_tech_len check (tech is null or char_length(tech) <= 60);
alter table public.requests drop constraint if exists requests_blanks_range;
alter table public.requests add constraint requests_blanks_range check (blanks_left between 0 and 50);
alter table public.request_events add column if not exists detail jsonb;
alter table public.request_events drop constraint if exists request_events_kind_check;
alter table public.request_events add constraint request_events_kind_check check (kind in ('created', 'status', 'message', 'urgency'));

-- Server-side rate limiting for the API functions. No policies: only the service role can use it.
create table if not exists public.api_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists api_usage_idx on public.api_usage (user_id, kind, created_at desc);
alter table public.api_usage enable row level security;

-- ---------------------------------------------------------------- helper functions
-- SECURITY DEFINER so policies can check membership without recursive RLS.
create or replace function public.is_manager(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where property_id = p and user_id = auth.uid() and role = 'manager');
$$;

create or replace function public.is_resident(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where property_id = p and user_id = auth.uid() and role = 'resident');
$$;

create or replace function public.is_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where property_id = p and user_id = auth.uid());
$$;

create or replace function public.can_see_request(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from requests q
    where q.id = r and (q.resident_id = auth.uid() or (q.property_id is not null and public.is_manager(q.property_id)))
  );
$$;

-- Two people "share a property" when one manages a property the other belongs to,
-- or both manage the same property. Used to show names in inboxes and message threads.
create or replace function public.can_see_profile(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select target = auth.uid() or exists (
    select 1 from memberships me join memberships them on them.property_id = me.property_id
    where me.user_id = auth.uid() and them.user_id = target
      and (me.role = 'manager' or them.role = 'manager')
  );
$$;

-- Human-friendly codes: no 0/O/1/I/L.
create or replace function public.gen_code(len int) returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out text := '';
  b bytea := gen_random_bytes(len);
begin
  for i in 0 .. len - 1 loop
    out := out || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------- triggers
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'full_name', 80), left(new.raw_user_meta_data ->> 'name', 80), ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists requests_touch on public.requests;
create trigger requests_touch before update on public.requests
  for each row execute function public.touch_updated_at();

create or replace function public.request_created_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into request_events (request_id, actor_id, kind, status) values (new.id, new.resident_id, 'created', 'new');
  return new;
end $$;
drop trigger if exists requests_created_event on public.requests;
create trigger requests_created_event after insert on public.requests
  for each row execute function public.request_created_event();

-- On insert the server decides the reference, timestamps, status and (for properties) the unit.
create or replace function public.prepare_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('canitwait.demo', true), '') = 'on' then return new; end if; -- sample data loader
  new.ref := 'CW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  new.created_at := now();
  new.updated_at := now();
  new.status := 'new';
  new.has_photo := new.photo_path is not null;
  new.scheduled_for := null; new.tech := null; new.first_visit := null; new.mgr_urgency := null;
  if new.property_id is not null then
    select unit into new.unit from memberships
      where property_id = new.property_id and user_id = new.resident_id and role = 'resident';
  end if;
  return new;
end $$;
drop trigger if exists requests_prepare on public.requests;
create trigger requests_prepare before insert on public.requests
  for each row execute function public.prepare_request();

-- Residents may only change a few things on their own request; managers only status (through set_request_status).
create or replace function public.guard_request_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.resident_id <> old.resident_id or new.property_id is distinct from old.property_id
     or new.external_place_id is distinct from old.external_place_id or new.ref <> old.ref
     or new.created_at <> old.created_at
     or new.ai_urgency is distinct from old.ai_urgency or new.ai_reason is distinct from old.ai_reason
     or new.manual_review <> old.manual_review or new.after_hours <> old.after_hours then
    raise exception 'These fields cannot be changed';
  end if;
  if (new.status <> old.status or new.scheduled_for is distinct from old.scheduled_for or new.tech is distinct from old.tech
      or new.first_visit is distinct from old.first_visit or new.mgr_urgency is distinct from old.mgr_urgency)
     and coalesce(current_setting('canitwait.mgr_change', true), '') <> 'on' then
    raise exception 'Use set_request_status or set_request_urgency to change status, visit details or urgency';
  end if;
  new.has_photo := new.photo_path is not null or (old.has_photo and new.photo_path is not distinct from old.photo_path);
  return new;
end $$;
drop trigger if exists requests_guard on public.requests;
create trigger requests_guard before update on public.requests
  for each row execute function public.guard_request_update();

-- ---------------------------------------------------------------- RPCs (called from the app)
create or replace function public.create_property(p_name text, p_address text default null, p_after_hours text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Property name is required'; end if;
  insert into properties (name, address, after_hours_phone, created_by)
  values (trim(p_name), nullif(trim(p_address), ''), nullif(trim(p_after_hours), ''), auth.uid())
  returning id into pid;
  insert into property_codes (property_id, resident_code, manager_code)
  values (pid, gen_code(4) || '-' || gen_code(4), 'M-' || gen_code(4) || '-' || gen_code(4));
  insert into memberships (property_id, user_id, role) values (pid, auth.uid(), 'manager');
  return pid;
end $$;

-- Join with a resident code (as resident, with unit) or a manager code (as co-manager).
create or replace function public.join_property(p_code text, p_unit text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  c text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  pid uuid; r member_role;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select property_id, 'resident'::member_role into pid, r from property_codes where resident_code = c;
  if pid is null then
    select property_id, 'manager'::member_role into pid, r from property_codes where manager_code = c;
  end if;
  if pid is null then raise exception 'That code does not match a property. Check it with your manager.'; end if;
  if r = 'resident' and coalesce(trim(p_unit), '') = '' then raise exception 'Add your unit number'; end if;
  insert into memberships (property_id, user_id, role, unit)
  values (pid, auth.uid(), r, case when r = 'resident' then trim(p_unit) end)
  on conflict (property_id, user_id, role) do update set unit = coalesce(excluded.unit, memberships.unit);
  return json_build_object('property_id', pid, 'role', r, 'name', (select name from properties where id = pid));
end $$;

create or replace function public.rotate_codes(p_property uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager(p_property) then raise exception 'Only managers can do this'; end if;
  update property_codes set resident_code = gen_code(4) || '-' || gen_code(4),
                            manager_code = 'M-' || gen_code(4) || '-' || gen_code(4),
                            rotated_at = now()
  where property_id = p_property;
end $$;

drop function if exists public.set_request_status(uuid, request_status, text);
-- Change a request's status. Managers can set any status and, for "scheduled", the visit time and technician;
-- for "resolved", whether it was fixed on the first visit. Residents can cancel or mark their own request fixed.
create or replace function public.set_request_status(
  p_request uuid, p_status request_status, p_note text default null,
  p_scheduled_for timestamptz default null, p_tech text default null, p_first_visit boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare q requests; mgr boolean;
begin
  select * into q from requests where id = p_request;
  if q.id is null then raise exception 'Request not found'; end if;
  mgr := q.property_id is not null and public.is_manager(q.property_id);
  if not mgr and not (q.resident_id = auth.uid() and p_status in ('canceled', 'resolved')) then
    raise exception 'You cannot change this request';
  end if;
  perform set_config('canitwait.mgr_change', 'on', true);
  update requests set
    status = p_status,
    scheduled_for = case when mgr and p_status = 'scheduled' then p_scheduled_for else scheduled_for end,
    tech = case when mgr and p_status = 'scheduled' then nullif(left(trim(p_tech), 60), '') else tech end,
    first_visit = case when p_status = 'resolved' and mgr then p_first_visit
                       when p_status in ('new', 'acknowledged') then null else first_visit end
  where id = p_request;
  perform set_config('canitwait.mgr_change', 'off', true);
  insert into request_events (request_id, actor_id, kind, status, body, detail)
  values (p_request, auth.uid(), 'status', p_status, nullif(trim(p_note), ''),
          nullif(jsonb_strip_nulls(jsonb_build_object(
            'scheduled_for', case when mgr and p_status = 'scheduled' then p_scheduled_for end,
            'tech', case when mgr and p_status = 'scheduled' then nullif(trim(p_tech), '') end,
            'first_visit', case when mgr and p_status = 'resolved' then p_first_visit end)), '{}'::jsonb));
end $$;

-- Managers can correct the urgency. Passing null goes back to what the resident sent.
create or replace function public.set_request_urgency(p_request uuid, p_urgency urgency_level default null)
returns void language plpgsql security definer set search_path = public as $$
declare q requests; final urgency_level;
begin
  select * into q from requests where id = p_request;
  if q.id is null or q.property_id is null or not public.is_manager(q.property_id) then raise exception 'Only managers can change urgency'; end if;
  final := coalesce(p_urgency, q.urgency);
  if final = coalesce(q.mgr_urgency, q.urgency) then return; end if;
  perform set_config('canitwait.mgr_change', 'on', true);
  update requests set mgr_urgency = case when p_urgency = q.urgency then null else p_urgency end where id = p_request;
  perform set_config('canitwait.mgr_change', 'off', true);
  insert into request_events (request_id, actor_id, kind, body, detail)
  values (p_request, auth.uid(), 'urgency', 'Urgency changed to ' || final, jsonb_build_object('urgency', final));
end $$;

-- Managers can remove a resident or co-manager; anyone can leave. A property keeps at least one manager.
create or replace function public.remove_membership(p_membership uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m memberships;
begin
  select * into m from memberships where id = p_membership;
  if m.id is null then raise exception 'Not found'; end if;
  if m.user_id <> auth.uid() then
    if not public.is_manager(m.property_id) then raise exception 'Not allowed'; end if;
    -- Only the property's owner (the manager who created it) can remove another manager.
    if m.role = 'manager' and not exists (select 1 from properties where id = m.property_id and (created_by = auth.uid() or created_by is null)) then
      raise exception 'Only the property owner can remove a manager';
    end if;
  end if;
  if m.role = 'manager' and (select count(*) from memberships where property_id = m.property_id and role = 'manager') <= 1 then
    raise exception 'A property needs at least one manager. Add another manager first, or delete the property.';
  end if;
  delete from memberships where id = p_membership;
end $$;

-- Residents and co-managers of a property, for the manager's property screen.
create or replace function public.property_people(p_property uuid)
returns table (membership_id uuid, user_id uuid, role member_role, unit text, full_name text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, m.role, m.unit, coalesce(p.full_name, ''), m.created_at
  from memberships m left join profiles p on p.id = m.user_id
  where m.property_id = p_property and public.is_manager(p_property)
  order by m.role, m.unit nulls last, p.full_name;
$$;

drop function if exists public.delete_my_account();  -- account deletion runs in api/delete-account.js

-- Sample data for demos: a separate property owned by the caller, with 16 realistic requests over the last
-- six weeks (repeat problems, a possible building-wide AC issue, emergencies, first-visit fixes).
-- Delete the "Sample data" property to remove all of it.
create or replace function public.load_demo_data()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pid uuid; rid uuid; c timestamptz; r record;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  pid := public.create_property('Sample data · Peachtree Commons', '1450 Peachtree St NW, Atlanta', '(404) 555-0100');
  insert into memberships (property_id, user_id, role, unit) values (pid, me, 'resident', 'Apt 214');
  perform set_config('canitwait.demo', 'on', true);
  for r in select * from (values
    -- days ago, hour, unit, category, title, AI urgency, resident urgency, manager urgency, reason, seen h, scheduled h, visit h, tech, note, fixed h, first visit, blanks, photo, manual
    (41, 22.0, 'Apt 214', 'Plumbing / Water', 'Ceiling drip over bathroom sink', 'Urgent', null, null, 'Slow drip caught in a bucket; can wait until morning.', 9.0, 10.0, 34.0, 'Marcus', null, 35.0, false, 0, true, false),
    (19, 10.0, 'Apt 214', 'Plumbing / Water', 'Leak under kitchen sink', 'Urgent', null, null, 'Contained leak under the sink.', 1.5, 2.0, 26.0, 'Marcus', null, 27.0, true, 0, true, false),
    (2, 23.0, 'Apt 214', 'Plumbing / Water', 'Water stain spreading on bathroom ceiling', 'Urgent', null, null, 'Stain is growing but no active dripping.', 10.0, 10.5, 34.0, 'Marcus', 'We''ll check the unit above yours too.', null, null, 1, true, false),
    (4, 21.0, 'Apt 305', 'Heating / AC', 'AC blowing warm air', 'Urgent', null, null, 'No AC in hot weather can wait until morning.', 11.0, null, null, null, null, null, null, 0, true, false),
    (3, 14.0, 'Apt 307', 'Heating / AC', 'AC not cooling, 84° inside', 'Urgent', null, null, 'No AC in hot weather.', 2.0, null, null, null, null, null, null, 0, true, false),
    (1, 22.0, 'Apt 112', 'Heating / AC', 'No cold air from vents', 'Urgent', null, null, 'No AC in hot weather.', null, null, null, null, null, null, null, 0, true, false),
    (12, 23.2, 'Apt 410', 'Gas', 'Gas smell near the stove', 'Emergency', null, null, 'A gas smell is always an emergency.', 0.12, null, null, null, null, 2.5, true, 0, false, false),
    (25, 1.7, 'Apt 220', 'Doors / Locks / Windows', 'Front door won''t lock', 'Emergency', null, null, 'An entry door that won''t lock is a security emergency.', 0.25, null, null, null, null, 3.0, true, 0, true, false),
    (9, 11.0, 'Apt 118', 'Electrical', 'Bedroom outlet stopped working', 'Routine', null, null, 'One dead outlet, no sparks or burning smell.', 3.0, 4.0, 50.0, 'Andre', null, 51.0, true, 0, true, false),
    (6, 20.0, 'Apt 302', 'Appliance', 'Fridge not keeping food cold', 'Urgent', null, null, 'Broken fridge can wait until morning.', 12.0, 12.5, 15.0, 'Andre', null, 16.0, false, 0, true, false),
    (15, 13.0, 'Apt 205', 'Other', 'Closet door off its track', 'Routine', null, null, 'Cosmetic, no safety issue.', 20.0, null, null, null, null, 70.0, true, 0, true, false),
    (30, 9.0, 'Apt 108', 'Pests', 'Ants in the kitchen', 'Routine', null, null, 'Small pest sighting.', 4.0, 5.0, 48.0, 'Pest vendor', null, 49.0, true, 0, true, false),
    (4, 19.0, 'Apt 216', 'Electrical', 'Bathroom fan very loud', 'Urgent', null, 'Routine', 'Unusual noise from an electrical fan.', 14.0, null, null, null, null, null, null, 0, true, false),
    (20, 23.0, 'Apt 401', 'Plumbing / Water', 'Toilet keeps running', 'Routine', null, null, 'Running toilet, still usable.', 10.0, null, null, null, null, 30.0, true, 2, false, false),
    (8, 0.5, 'Apt 118', 'Ceiling / Walls / Floors', 'Crack above bedroom window', null, 'Urgent', null, null, 9.0, null, null, null, null, null, null, 0, true, true),
    (33, 22.0, 'Apt 302', 'Plumbing / Water', 'Kitchen sink draining slowly', 'Routine', 'Urgent', null, 'Slow drain.', 11.0, null, null, null, null, 40.0, true, 0, true, false)
  ) as t(d, h, unit, cat, title, ai, res_u, mgr_u, why, seen, sched, visit, tech, note, fixed, first, blanks, photo, manual)
  loop
    c := date_trunc('day', now()) - make_interval(days => r.d) + make_interval(secs => r.h * 3600);
    if c > now() then c := now() - interval '40 minutes'; end if;
    insert into requests (resident_id, property_id, unit, title, category, urgency, ai_urgency, ai_reason, body, manual_review,
                          after_hours, blanks_left, has_photo, ref, created_at, updated_at, status, mgr_urgency,
                          scheduled_for, tech, first_visit)
    values (me, pid, r.unit, r.title, r.cat, coalesce(r.res_u, r.ai)::urgency_level, r.ai::urgency_level, r.why,
            r.title || '. It''s in my apartment and I''d like it looked at.', r.manual,
            extract(hour from c) < 8 or extract(hour from c) >= 18 or extract(isodow from c) >= 6, r.blanks, r.photo,
            'CW-S' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5)), c, c,
            (case when r.fixed is not null then 'resolved' when r.sched is not null then 'scheduled' when r.seen is not null then 'acknowledged' else 'new' end)::request_status,
            r.mgr_u::urgency_level,
            case when r.visit is not null then c + make_interval(secs => r.visit * 3600) end, r.tech, r.first)
    returning id into rid;
    update request_events set created_at = c where request_id = rid and kind = 'created';
    if r.seen is not null then
      insert into request_events (request_id, actor_id, kind, status, created_at, notified_at) values (rid, me, 'status', 'acknowledged', c + make_interval(secs => r.seen * 3600), now());
    end if;
    if r.mgr_u is not null then
      insert into request_events (request_id, actor_id, kind, body, detail, created_at, notified_at)
      values (rid, me, 'urgency', 'Urgency changed to ' || r.mgr_u, jsonb_build_object('urgency', r.mgr_u), c + make_interval(secs => (coalesce(r.seen, 0) + 0.1) * 3600), now());
    end if;
    if r.sched is not null then
      insert into request_events (request_id, actor_id, kind, status, body, detail, created_at, notified_at)
      values (rid, me, 'status', 'scheduled', r.note, jsonb_build_object('scheduled_for', c + make_interval(secs => r.visit * 3600), 'tech', r.tech), c + make_interval(secs => r.sched * 3600), now());
    end if;
    if r.fixed is not null then
      insert into request_events (request_id, actor_id, kind, status, detail, created_at, notified_at)
      values (rid, me, 'status', 'resolved', jsonb_build_object('first_visit', r.first), c + make_interval(secs => r.fixed * 3600), now());
    end if;
  end loop;
  perform set_config('canitwait.demo', 'off', true);
  return pid;
end $$;

-- ---------------------------------------------------------------- row level security
alter table public.profiles        enable row level security;
alter table public.properties      enable row level security;
alter table public.property_codes  enable row level security;
alter table public.memberships     enable row level security;
alter table public.external_places enable row level security;
alter table public.requests        enable row level security;
alter table public.request_events  enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (public.can_see_profile(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select to authenticated using (public.is_member(id));
drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated using (public.is_manager(id)) with check (public.is_manager(id));
drop policy if exists properties_delete on public.properties;
create policy properties_delete on public.properties for delete to authenticated
  using (public.is_manager(id) and (created_by = auth.uid() or created_by is null));

drop policy if exists codes_select on public.property_codes;
create policy codes_select on public.property_codes for select to authenticated using (public.is_manager(property_id));

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_manager(property_id));
drop policy if exists memberships_update on public.memberships;  -- memberships change only through RPCs

drop policy if exists places_all on public.external_places;
create policy places_all on public.external_places for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (resident_id = auth.uid() or (property_id is not null and public.is_manager(property_id)));
drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert to authenticated with check (
  resident_id = auth.uid() and status = 'new'
  and (photo_path is null or photo_path like auth.uid()::text || '/%')
  and (
    (property_id is not null and public.is_resident(property_id) and external_place_id is null)
    or (property_id is null and exists (select 1 from external_places e where e.id = external_place_id and e.user_id = auth.uid()))
  )
);
-- Residents can edit their own open request text and access details; status changes go through set_request_status.
drop policy if exists requests_update_own on public.requests;
create policy requests_update_own on public.requests for update to authenticated
  using (resident_id = auth.uid() and status in ('new', 'acknowledged'))
  with check (resident_id = auth.uid() and status in ('new', 'acknowledged')
              and (photo_path is null or photo_path like auth.uid()::text || '/%'));

drop policy if exists events_select on public.request_events;
create policy events_select on public.request_events for select to authenticated using (public.can_see_request(request_id));
drop policy if exists events_insert on public.request_events;
create policy events_insert on public.request_events for insert to authenticated with check (
  kind = 'message' and actor_id = auth.uid() and status is null and notified_at is null and detail is null
  and char_length(coalesce(body, '')) between 1 and 2000
  and exists (
    select 1 from public.requests q where q.id = request_id and q.property_id is not null
      and (public.is_manager(q.property_id) or (q.resident_id = auth.uid() and public.is_resident(q.property_id)))
  )
);

-- Writes not covered by a policy above are denied (RLS default). Tables that need RPCs for writes:
-- properties (create_property), property_codes, memberships (join_property / remove_membership), request status.

-- Make RPCs callable only by signed-in users.
revoke execute on function public.create_property(text, text, text) from public, anon;
revoke execute on function public.join_property(text, text) from public, anon;
revoke execute on function public.rotate_codes(uuid) from public, anon;
revoke execute on function public.set_request_status(uuid, request_status, text, timestamptz, text, boolean) from public, anon;
revoke execute on function public.set_request_urgency(uuid, urgency_level) from public, anon;
revoke execute on function public.load_demo_data() from public, anon;
revoke execute on function public.remove_membership(uuid) from public, anon;
revoke execute on function public.property_people(uuid) from public, anon;
grant execute on function public.create_property(text, text, text) to authenticated;
grant execute on function public.join_property(text, text) to authenticated;
grant execute on function public.rotate_codes(uuid) to authenticated;
grant execute on function public.set_request_status(uuid, request_status, text, timestamptz, text, boolean) to authenticated;
grant execute on function public.set_request_urgency(uuid, urgency_level) to authenticated;
grant execute on function public.load_demo_data() to authenticated;
grant execute on function public.remove_membership(uuid) to authenticated;
grant execute on function public.property_people(uuid) to authenticated;

-- ---------------------------------------------------------------- live updates
do $$ begin
  alter publication supabase_realtime add table public.requests;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.request_events;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------------------------------------------------------------- photo storage (private bucket)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-photos', 'request-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Files live at <user id>/<file>. Owners upload and read their own; managers read photos attached to requests they can see.
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'request-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists photos_select on storage.objects;
create policy photos_select on storage.objects for select to authenticated using (
  bucket_id = 'request-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.requests q where q.photo_path = name and q.property_id is not null and public.is_manager(q.property_id))
  )
);
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'request-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
