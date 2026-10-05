-- FixCheck database: run this once in Supabase → SQL Editor (or `supabase db push`).
-- Everything is protected by Row Level Security: people only see what their memberships allow.
--
-- Model
--   profiles          one per account (name, phone, notification setting)
--   properties        a building/community a manager runs
--   property_codes    join codes (resident code + co-manager code); readable by managers only
--   memberships       who belongs to which property, as 'manager' or 'resident' (+ unit)
--   external_places   a renter's place whose landlord isn't on FixCheck (requests go by email/text)
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
  ref                text not null unique default ('FC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
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
  new.ref := 'FC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  new.created_at := now();
  new.updated_at := now();
  new.status := 'new';
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
     or new.manual_review <> old.manual_review then
    raise exception 'These fields cannot be changed';
  end if;
  if new.status <> old.status and coalesce(current_setting('fixcheck.status_change', true), '') <> 'on' then
    raise exception 'Use set_request_status to change status';
  end if;
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

create or replace function public.set_request_status(p_request uuid, p_status request_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare q requests;
begin
  select * into q from requests where id = p_request;
  if q.id is null then raise exception 'Request not found'; end if;
  if q.property_id is not null and public.is_manager(q.property_id) then
    null; -- managers can set any status
  elsif q.resident_id = auth.uid() and p_status in ('canceled', 'resolved') then
    null; -- residents can cancel, or mark resolved on their own request
  else
    raise exception 'You cannot change this request';
  end if;
  perform set_config('fixcheck.status_change', 'on', true);
  update requests set status = p_status where id = p_request;
  perform set_config('fixcheck.status_change', 'off', true);
  insert into request_events (request_id, actor_id, kind, status, body)
  values (p_request, auth.uid(), 'status', p_status, nullif(trim(p_note), ''));
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
  kind = 'message' and actor_id = auth.uid() and status is null and notified_at is null
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
revoke execute on function public.set_request_status(uuid, request_status, text) from public, anon;
revoke execute on function public.remove_membership(uuid) from public, anon;
revoke execute on function public.property_people(uuid) from public, anon;
grant execute on function public.create_property(text, text, text) to authenticated;
grant execute on function public.join_property(text, text) to authenticated;
grant execute on function public.rotate_codes(uuid) to authenticated;
grant execute on function public.set_request_status(uuid, request_status, text) to authenticated;
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
