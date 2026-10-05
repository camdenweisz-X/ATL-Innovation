// Access-rule tests: runs the migration in an in-memory Postgres (PGlite) with Supabase stubs.
// Run: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "fs";
const db = await PGlite.create({ extensions: { pgcrypto } });
const stub = `
create role anon nologin; create role authenticated nologin;
create schema extensions; grant usage on schema extensions to anon, authenticated;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
create publication supabase_realtime;
grant usage on schema public, auth, storage to anon, authenticated;
grant all on storage.objects to authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`;
await db.exec(stub);
await db.exec(fs.readFileSync(new URL("../migrations/0001_canitwait.sql", import.meta.url), "utf8"));
// run migration twice to prove it is re-runnable
await db.exec(fs.readFileSync(new URL("../migrations/0001_canitwait.sql", import.meta.url), "utf8"));
console.log("migration ran twice OK");

const U = { M:"00000000-0000-0000-0000-00000000000a", R:"00000000-0000-0000-0000-00000000000b", O:"00000000-0000-0000-0000-00000000000c", M2:"00000000-0000-0000-0000-00000000000d", R2:"00000000-0000-0000-0000-00000000000e" };
for (const [k,id] of Object.entries(U)) await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)`, [id, k.toLowerCase()+"@x.com", JSON.stringify({full_name:"User "+k})]);
let pass=0, fail=0;
const as = async (who, sql, params=[]) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [U[who]||""]);
  await db.exec("set role authenticated");
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
};
const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond?"PASS ":"FAIL ")+name); };
const throws = async (name, fn) => { try { await fn(); ok(name+" (should be refused)", false); } catch(e){ ok(name+" refused: "+e.message.slice(0,70), true); } };

const pid = (await as("M", "select public.create_property('Peachtree Commons','1 Main St','404-555-0100') as id")).rows[0].id;
const codes = (await as("M", "select * from property_codes where property_id=$1",[pid])).rows[0];
ok("manager sees codes", !!codes?.resident_code && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(codes.resident_code));
await as("R", "select public.join_property($1,'Apt 23')", [codes.resident_code.toLowerCase()]);
ok("resident joined (lowercase code ok)", (await as("R","select count(*)::int n from memberships where user_id=auth.uid()")).rows[0].n===1);
await throws("join without unit", ()=>as("O","select public.join_property($1,'')",[codes.resident_code]));
await throws("join bad code", ()=>as("O","select public.join_property('ZZZZ-ZZZZ','1')"));
ok("resident cannot read codes", (await as("R","select count(*)::int n from property_codes")).rows[0].n===0);
ok("outsider cannot see property", (await as("O","select count(*)::int n from properties")).rows[0].n===0);
await throws("outsider direct membership insert", ()=>as("O","insert into memberships (property_id,user_id,role) values ($1,auth.uid(),'manager')",[pid]));

const req = (await as("R", `insert into requests (property_id, unit, title, category, urgency, ai_urgency, ai_reason, body)
  values ($1,'Apt 23','Ceiling drip','Plumbing / Water','Urgent','Urgent','Slow leak','Water drips') returning id`, [pid])).rows[0].id;
ok("resident created request", !!req);
await throws("outsider request into property", ()=>as("O", `insert into requests (property_id,title,category,urgency,body) values ($1,'x','Other','Routine','x')`,[pid]));
await throws("resident forges resident_id", ()=>as("R", `insert into requests (resident_id,property_id,title,category,urgency,body) values ($1,$2,'x','Other','Routine','x')`,[U.O,pid]));
ok("manager sees request", (await as("M","select count(*)::int n from requests")).rows[0].n===1);
ok("outsider sees no request", (await as("O","select count(*)::int n from requests")).rows[0].n===0);
ok("created event exists", (await as("R","select count(*)::int n from request_events where request_id=$1 and kind='created'",[req])).rows[0].n===1);
await throws("resident sets status directly", ()=>as("R","update requests set status='resolved' where id=$1",[req]));
await throws("resident changes AI urgency", ()=>as("R","update requests set ai_urgency='Routine' where id=$1",[req]));
await as("R","update requests set body='Water drips faster now' where id=$1",[req]);
ok("resident edited own body", (await as("R","select body from requests where id=$1",[req])).rows[0].body.includes("faster"));
const mUpd = await as("M","update requests set body='hacked' where id=$1 returning id",[req]);
ok("manager cannot edit body directly", mUpd.rows.length===0);
await as("M","select public.set_request_status($1,'scheduled','Plumber tomorrow 9-11')",[req]);
ok("manager scheduled", (await as("R","select status from requests where id=$1",[req])).rows[0].status==="scheduled");
await throws("resident set scheduled via RPC", ()=>as("R","select public.set_request_status($1,'in_progress')",[req]));
await throws("outsider set status", ()=>as("O","select public.set_request_status($1,'resolved')",[req]));
await as("R","insert into request_events (request_id, kind, body) values ($1,'message','Thanks! I will be home.')",[req]);
await throws("outsider message", ()=>as("O","insert into request_events (request_id, kind, body) values ($1,'message','hi')",[req]));
await throws("resident fakes status event", ()=>as("R","insert into request_events (request_id, kind, status) values ($1,'status','resolved')",[req]));
ok("manager sees 3 events", (await as("M","select count(*)::int n from request_events where request_id=$1",[req])).rows[0].n===3);
ok("outsider sees no events", (await as("O","select count(*)::int n from request_events")).rows[0].n===0);
ok("manager sees resident name", (await as("M","select full_name from profiles where id=$1",[U.R])).rows[0]?.full_name==="User R");
ok("resident sees manager name", (await as("R","select count(*)::int n from profiles where id=$1",[U.M])).rows[0].n===1);
ok("outsider cannot see resident name", (await as("O","select count(*)::int n from profiles where id=$1",[U.R])).rows[0].n===0);
ok("resident cannot see other residents' memberships", (await as("R","select count(*)::int n from memberships")).rows[0].n===1);
// co-manager
await as("M2","select public.join_property($1)",[codes.manager_code]);
ok("co-manager sees request", (await as("M2","select count(*)::int n from requests")).rows[0].n===1);
ok("people list for manager", (await as("M","select count(*)::int n from public.property_people($1)",[pid])).rows[0].n===3);
ok("people list hidden from resident", (await as("R","select count(*)::int n from public.property_people($1)",[pid])).rows[0].n===0);
// rotate codes
await throws("resident rotate codes", ()=>as("R","select public.rotate_codes($1)",[pid]));
await as("M","select public.rotate_codes($1)",[pid]);
await throws("old code after rotate", ()=>as("O","select public.join_property($1,'5')",[codes.resident_code]));
// external places
const ext = (await as("R2","insert into external_places (label, contact_email) values ('My duplex','landlord@x.com') returning id")).rows[0].id;
await as("R2","insert into requests (external_place_id,title,category,urgency,body) values ($1,'Bulb','Electrical','Routine','Bulb out')",[ext]);
ok("manager cannot see external request", (await as("M","select count(*)::int n from requests")).rows[0].n===1);
await throws("place without contact", ()=>as("R2","insert into external_places (label) values ('x')"));
await throws("request into someone else's place", ()=>as("R","insert into requests (external_place_id,title,category,urgency,body) values ($1,'x','Other','Routine','x')",[ext]));
// storage
await as("R","insert into storage.objects (bucket_id,name) values ('request-photos', $1)",[U.R+"/p1.jpg"]);
await throws("upload into another user's folder", ()=>as("R","insert into storage.objects (bucket_id,name) values ('request-photos', $1)",[U.O+"/p.jpg"]));
await db.exec("reset role"); await db.query("update requests set photo_path=$1 where id=$2",[U.R+"/p1.jpg", req]);
ok("manager can read attached photo", (await as("M","select count(*)::int n from storage.objects")).rows[0].n===1);
ok("outsider cannot read photo", (await as("O","select count(*)::int n from storage.objects")).rows[0].n===0);
// leave / last manager
const mm = (await as("M","select id from memberships where user_id=auth.uid()")).rows[0].id;
await as("M","select public.remove_membership($1)",[mm]);
ok("manager left while co-manager remains", (await as("M2","select count(*)::int n from memberships where role='manager'")).rows[0].n===1);
const m2m = (await as("M2","select id from memberships where user_id=auth.uid()")).rows[0].id;
await throws("last manager leaves", ()=>as("M2","select public.remove_membership($1)",[m2m]));
// review fixes
const myProp = (await as("O","select public.create_property('Outsider Place') as id")).rows[0].id;
const oc = (await as("O","select resident_code from property_codes where property_id=$1",[myProp])).rows[0].resident_code;
await as("R2","select public.join_property($1,'9')",[oc]);
const r2m = (await as("R2","select id from memberships where user_id=auth.uid() and property_id=$1",[myProp])).rows[0].id;
const moved = await as("R2","update memberships set property_id=$1 where id=$2 returning id",[pid, r2m]);
ok("resident cannot move membership to another property", moved.rows.length===0);
await throws("request with someone else's photo path", ()=>as("R2","insert into requests (property_id,title,category,urgency,body,photo_path) values ($1,'x','Other','Routine','x',$2)",[myProp, U.R+"/p1.jpg"]));
const forged = (await as("R2","insert into requests (property_id,unit,title,category,urgency,body,created_at,ref) values ($1,'Penthouse','x','Other','Routine','x','2020-01-01','FC-HACKED') returning unit, created_at, ref",[myProp])).rows[0];
ok("server sets unit/created_at/ref", forged.unit==='9' && new Date(forged.created_at).getFullYear()>2020 && forged.ref!=='FC-HACKED');
// removed resident can't keep messaging
await as("O","select public.remove_membership($1)",[r2m]);
const r2req = (await as("R2","select id from requests where property_id=$1 limit 1",[myProp])).rows[0].id;
await throws("removed resident messages manager", ()=>as("R2","insert into request_events (request_id, kind, body) values ($1,'message','hi')",[r2req]));
ok("removed resident still sees own request", (await as("R2","select count(*)::int n from requests where id=$1",[r2req])).rows[0].n===1);
// co-manager limits
await as("M","select public.join_property($1)",[ (await as("M2","select manager_code from property_codes where property_id=$1",[pid])).rows[0].manager_code ]);
// M created the property (owner); M2 joined with the co-manager code.
const ownerDel = await as("M2","delete from properties where id=$1 returning id",[pid]);
ok("co-manager cannot delete a property they didn't create", ownerDel.rows.length===0);
const mmid = (await as("M2","select id from memberships where user_id=$1 and property_id=$2 and role='manager'",[U.M,pid])).rows[0].id;
await throws("co-manager removes the owner", ()=>as("M2","select public.remove_membership($1)",[mmid]));
const m2mid = (await as("M","select id from memberships where user_id=$1 and property_id=$2 and role='manager'",[U.M2,pid])).rows[0].id;
await as("M","select public.remove_membership($1)",[m2mid]);
ok("owner can remove a co-manager", (await as("M","select count(*)::int n from memberships where property_id=$1 and role='manager'",[pid])).rows[0].n===1);
// work orders
await as("M","select public.set_request_status($1,'scheduled','Bring a ladder', now() + interval '1 day', 'Marcus')",[req]);
const wo = (await as("R","select status, tech, scheduled_for from requests where id=$1",[req])).rows[0];
ok("manager scheduled with tech and time", wo.status==="scheduled" && wo.tech==="Marcus" && !!wo.scheduled_for);
const evd = (await as("R","select detail from request_events where request_id=$1 and kind='status' order by created_at desc limit 1",[req])).rows[0].detail;
ok("schedule event records visit details", evd && evd.tech==="Marcus");
// An open ("new") request the resident may still edit: work-order fields stay locked.
const openReq = (await as("R",`insert into requests (property_id,title,category,urgency,body) values ($1,'Bulb','Electrical','Routine','Bulb out') returning id`,[pid])).rows[0].id;
await throws("resident changes tech directly", ()=>as("R","update requests set tech='Me' where id=$1",[openReq]));
await throws("resident sets manager urgency directly", ()=>as("R","update requests set mgr_urgency='Emergency' where id=$1",[openReq]));
ok("closed request can't be edited by resident", (await as("R","update requests set body='changed' where id=$1 returning id",[req])).rows.length===0);
await throws("resident fakes event detail", ()=>as("R","insert into request_events (request_id, kind, body, detail) values ($1,'message','hi','{\"first_visit\":true}')",[req]));
await as("M","select public.set_request_urgency($1,'Routine')",[req]);
ok("manager overrode urgency", (await as("R","select mgr_urgency from requests where id=$1",[req])).rows[0].mgr_urgency==="Routine");
await throws("resident overrides urgency", ()=>as("R","select public.set_request_urgency($1,'Emergency')",[req]));
await as("M","select public.set_request_status($1,'resolved',null,null,null,false)",[req]);
ok("fixed with return trip recorded", (await as("M","select first_visit from requests where id=$1",[req])).rows[0].first_visit===false);
const presetReq = (await as("R",`insert into requests (property_id,title,category,urgency,body,tech,mgr_urgency,first_visit) values ($1,'x','Other','Routine','x','Hacker','Emergency',true) returning tech, mgr_urgency, first_visit`,[pid])).rows[0];
ok("residents can't preset work-order fields", presetReq.tech===null && presetReq.mgr_urgency===null && presetReq.first_visit===null);
// sample data
const demo = (await as("R2","select public.load_demo_data() as id")).rows[0].id;
ok("sample data: 16 requests", (await as("R2","select count(*)::int n from requests where property_id=$1",[demo])).rows[0].n===16);
ok("sample data: backdated history", (await as("R2","select count(*)::int n from request_events e join requests q on q.id=e.request_id where q.property_id=$1 and e.created_at < now() - interval '30 days'",[demo])).rows[0].n>0);
ok("sample data hidden from others", (await as("M","select count(*)::int n from requests where property_id=$1",[demo])).rows[0].n===0);
await as("R2","delete from properties where id=$1",[demo]);
ok("deleting sample property removes it", (await as("R2","select count(*)::int n from requests where property_id=$1",[demo])).rows[0].n===0);
await db.exec("reset role");
ok("api_usage hidden from clients", (await as("R","select count(*)::int n from api_usage")).rows[0].n===0);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
