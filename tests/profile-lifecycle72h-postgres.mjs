import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const candidate=fs.readFileSync('supabase/profile-lifecycle72h.sql','utf8');
assert(!/delete\s+from/i.test(candidate),'scheduled finalizer must never delete');
assert(!/insert into public\.profile_media_gc/i.test(candidate),'no media deletion queue');
const baseline=fs.readFileSync('supabase/profile-lifecycle72h.rollback.sql','utf8');
assert(!/delete\s+from/i.test(baseline),'safe fallback must not restore purge');
const hashes=['a3cf82662fce2750331bd3faeeb2b31e08d8bd39662997ff1fa7fe9f66d40f17','f671132dc61ee10c96da33fa19c3cb45aac44722c12225f351f39d2960824a91','acaf55107ff512d127036e4e46a02fa388b0dcde59b7808e73dd68157b94dc9c'];
let sql=candidate;
let rollback=baseline;
let offset=1;
let inserts='';
for(const [i,n] of [309,688,538].entries()){
 const ids=Array.from({length:n},(_,j)=>'00000000-0000-0000-0000-'+(offset+j).toString(16).padStart(12,'0'));
 const hash=crypto.createHash('sha256').update(ids.join('\n')).digest('hex');
 assert(candidate.includes(hashes[i]),'fixed production hold hash preserved');
 sql=sql.replace(hashes[i],hash); rollback=rollback.replace(hashes[i],hash);
 inserts+='create table private.sexy00_purge_hold'+n+'(profile_id uuid primary key);\n';
 inserts+='insert into private.sexy00_purge_hold'+n+" values "+ids.map(id=>"('"+id+"')").join(',')+';\n';
 offset+=n;
}
const fixture=`
begin;
create schema private;
create table public.profiles(id uuid primary key,source_provider text,source_key text,status text,source_last_seen_at timestamptz,updated_at timestamptz default now(),card_image_path text);
create table public.profile_sync_lifecycle(profile_id uuid primary key,missed_snapshots integer default 0,first_missing_at timestamptz,archived_at timestamptz,archived_by_cleanup boolean default false);
create table public.profile_sync_state(provider text primary key,last_capture timestamptz,source_count integer);
create table public.profile_sync_runs(id bigint generated always as identity,provider text,mode text,status text,summary jsonb,completed_at timestamptz);
create table public.profile_media_gc(path text primary key);
create table public.profile_images(profile_id uuid,storage_path text);
create table public.profile_source_images(profile_id uuid,storage_path text);
create function pg_temp.check(ok boolean,label text) returns void language plpgsql as $b$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end; $b$;
`;
console.log(fixture+inserts+sql);
console.log(`
insert into profiles(id,source_provider,source_key,status,source_last_seen_at) values
 ('ffffffff-0000-0000-0000-000000000001','edc-public-catalog','1','published',now()),
 ('ffffffff-0000-0000-0000-000000000002','edc-public-catalog','2','published',now()-interval '1 day'),
 ('00000000-0000-0000-0000-000000000001','edc-public-catalog','3','archived',now()-interval '5 days');
select sexy00_complete_profile_snapshot(array['1'],now()-interval '1 hour',1,1);
select pg_temp.check((select status='archived' from profiles where source_key='2'),'first complete absence hides immediately');
select pg_temp.check((select (summary->>'deleted')::int=0 and (summary->>'pendingDeletionConfirmation')::int=0 from profile_sync_runs order by id desc limit 1),'first absence never deletes or queues');
select pg_temp.check((select count(*)=3 from profiles),'all original rows retained');
select pg_temp.check((sexy00_complete_profile_snapshot(array['1'],now()-interval '1 hour',1,1)->>'status')='duplicate','duplicate snapshot no progress');
select pg_temp.check((select missed_snapshots=1 from profile_sync_lifecycle where profile_id='ffffffff-0000-0000-0000-000000000002'),'duplicate does not age lifecycle');
update profile_sync_lifecycle set first_missing_at=now()-interval '73 hours',archived_at=now()-interval '73 hours',archived_by_cleanup=true;
select sexy00_complete_profile_snapshot(array['1'],now()-interval '30 minutes',1,1);
select pg_temp.check((select (summary->>'pendingDeletionConfirmation')::int=1 from profile_sync_runs order by id desc limit 1),'72h newer successful snapshot queues unprotected only');
select pg_temp.check((select count(*)=3 from profiles),'72h queue does not delete');
select pg_temp.check((select count(*)=0 from profile_media_gc),'no media deletion queued');
do $b$ begin
 begin perform sexy00_complete_profile_snapshot(array['1'],now(),2,1); raise exception 'should reject'; exception when others then if sqlerrm='should reject' then raise; end if; end;
end; $b$;
select pg_temp.check((select count(*)=2 from profile_sync_runs),'invalid total does not advance snapshot');

-- Exclusions require a successful same-capture receipt from the importer.
insert into profile_sync_runs(provider,mode,status,summary,completed_at) values
('edc-public-catalog','source-exclusion','success',jsonb_build_object('version',1,'sourceKey','999999','reason','unmapped-city','capture',to_char((now()-interval '15 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),now());
select pg_temp.check((sexy00_complete_profile_snapshot(array['1','999999'],now()-interval '15 minutes',2,1)->>'status')='ready','same-capture persisted exclusion accepted');
select pg_temp.check((sexy00_complete_profile_snapshot(array['1','999999'],now()-interval '10 minutes',2,1)->>'reason')='snapshot-import-proof-missing','stale capture receipt rejected');
insert into profile_sync_runs(provider,mode,status,summary,completed_at) values
('edc-public-catalog','source-exclusion','success',jsonb_build_object('version',1,'sourceKey','888888','reason','age-unknown','capture',to_char((now()-interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),now());
select pg_temp.check((sexy00_complete_profile_snapshot(array['1','888888'],now()-interval '5 minutes',2,1)->>'reason')='snapshot-import-proof-missing','unknown exclusion reason rejected');
update profiles set source_last_seen_at=now(),status='published' where source_key='2';
select sexy00_complete_profile_snapshot(array['1','2'],now(),2,1);
select pg_temp.check((select first_missing_at is null and missed_snapshots=0 from profile_sync_lifecycle where profile_id='ffffffff-0000-0000-0000-000000000002'),'return clears missing lifecycle');
select pg_temp.check((select status='published' from profiles where source_key='2'),'return publication decision left to existing verified importer');
-- A newer importer result must not be hidden by an older capture.
update profiles set source_last_seen_at=now()+interval '2 minutes' where source_key='2';
select sexy00_complete_profile_snapshot(array['1'],now()+interval '1 minute',1,1);
select pg_temp.check((select status='published' from profiles where source_key='2'),'newer imported profile protected');
-- Fixed-manifest drift fails closed before any lifecycle changes.
savepoint manifest;
delete from private.sexy00_purge_hold538 where profile_id=(select min(profile_id::text)::uuid from private.sexy00_purge_hold538);
do $b$ begin
 begin perform sexy00_complete_profile_snapshot(array['1'],now()+interval '3 minutes',1,1); raise exception 'should reject'; exception when others then if sqlerrm='should reject' then raise; end if; end;
end; $b$;
rollback to manifest;
select pg_temp.check((sexy00_complete_profile_snapshot(array['1','999999'],now()+interval '2 minutes',2,1)->>'reason')='snapshot-import-proof-missing','missing new source key blocks archival');
select pg_temp.check((select count(*)=3 from profiles),'missing import preserves records');
-- Confirm anomalous loss blocks rather than bulk hiding.
update profile_sync_state set source_count=1000;
select pg_temp.check((sexy00_complete_profile_snapshot(array['1'],now()+interval '3 minutes',1,1)->>'status')='blocked','large count drop blocked');
select pg_temp.check((select count(*)=3 from profiles),'blocked snapshot preserves rows');
`);
console.log(rollback);
console.log("select pg_temp.check(position('purge_ids' in pg_get_functiondef('public.sexy00_complete_profile_snapshot(text[],timestamptz,integer,integer)'::regprocedure))>0,'rollback definition compiles');");
console.log(sql);
console.log("select pg_temp.check(position('72h-confirmation-v1' in pg_get_functiondef('public.sexy00_complete_profile_snapshot(text[],timestamptz,integer,integer)'::regprocedure))>0,'candidate reapplies after rollback'); rollback;");
