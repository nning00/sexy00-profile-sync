\set ON_ERROR_STOP on
-- Fresh isolated CI database only. No production connection or fixture data.
create schema private;
create schema storage;
create role anon;
create role authenticated;
create role service_role bypassrls;
create table storage.objects(id uuid primary key, bucket_id text, name text, version text, updated_at timestamptz default now());
create table public.admin_users(user_id uuid primary key);
create table public.profiles(id uuid primary key, slug text, status text, updated_at timestamptz default now(),
  source_provider text, source_key text, source_url text, display_name text, introduction text,
  source_content_hash text, adult_verified_at timestamptz, adult_verified_by uuid,
  adult_review_status text, card_image_path text);
create table public.profile_source_images(profile_id uuid,source_url text,storage_path text,created_at timestamptz default now());
create table public.profile_images(profile_id uuid,storage_path text);
create table public.cities(id integer,name text);
create table public.profile_cities(profile_id uuid,city_id integer);
create function public.touch_fixture_profile() returns trigger language plpgsql as $$
begin new.updated_at:=clock_timestamp(); return new; end $$;
create trigger touch_fixture_profile before update on public.profiles for each row execute function public.touch_fixture_profile();

\ir ../supabase/adult-verification-receipts.sql
\ir ../supabase/adult-publish-queue.sql

grant usage on schema storage to service_role;
grant select on all tables in schema public,storage to service_role;
grant update on public.profiles,public.profile_source_images,public.profile_images,public.profile_cities,storage.objects to service_role;
insert into public.admin_users values('00000000-0000-4000-8000-000000000099');

begin;
insert into public.profiles(id,slug,status,source_provider,source_key,source_url,display_name,introduction,
  source_content_hash,adult_review_status,card_image_path)
select ('00000000-0000-4000-8000-00000000000'||i)::uuid,'qa-original-'||i,'draft','edc-public-catalog',
  'qa-'||i,'https://example.invalid/profile/'||i,'Synthetic '||i,
  case when i=4 then '{"age":"17"}' else '{"age":""}' end,repeat('a',64),'pending','gpt-copy/profiles/qa/'||i||'.jpg'
from generate_series(1,5) i;
insert into public.profile_source_images(profile_id,source_url,storage_path)
select id,source_url||'/image',card_image_path from public.profiles;
insert into storage.objects(id,bucket_id,name,version)
select id,'site-media',card_image_path,'revision-current' from public.profiles;
-- Row 3 fails the final publication check AFTER the existing stage RPC succeeds.
insert into public.profile_images
values('00000000-0000-4000-8000-000000000003','gpt-copy/profiles/qa/unreviewed.jpg');

do $$
begin
  if has_function_privilege('anon','public.sexy00_confirm_publish_adult_batch(jsonb,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.sexy00_adult_review_media_versions(text[])','EXECUTE')
  then raise exception 'Batch function accessible to non-service roles'; end if;
end $$;

set local role service_role;
do $$
declare payload jsonb; result jsonb; reviewer uuid:='00000000-0000-4000-8000-000000000099';
begin
  if jsonb_array_length(public.sexy00_adult_review_media_versions(array['gpt-copy/profiles/qa/1.jpg']))<>1
  then raise exception 'Cannot read expected storage stamp'; end if;
  select jsonb_agg(jsonb_build_object('id',p.id,'version',p.updated_at,'hash',p.source_content_hash,
    'photos',jsonb_build_array(jsonb_build_object('source_url',im.source_url,'storage_path',o.name,
      'object_id',o.id,'updated_at',o.updated_at,'revision',case when p.source_key='qa-2' then 'changed' else o.version end,
      'sha256',repeat('b',64),'profile_snapshot',jsonb_build_object('source_key',p.source_key,'source_url',p.source_url,
        'display_name',p.display_name,'introduction',p.introduction,'city_names','[]'::jsonb)))) order by p.id)
  into payload from public.profiles p join storage.objects o on o.id=p.id
  join public.profile_source_images im on im.profile_id=p.id
  where p.source_key in ('qa-1','qa-2','qa-3','qa-4');

  begin
    perform public.sexy00_confirm_publish_adult_batch(payload,'00000000-0000-4000-8000-000000000098');
    raise exception 'non-admin batch accepted';
  exception when raise_exception then
    if sqlerrm<>'Reviewer required' then raise; end if;
  end;
  result:=public.sexy00_confirm_publish_adult_batch(payload,reviewer);
  if result->0->>'slug' is distinct from 'qa-original-1'
    or not exists(select 1 from public.profiles where source_key='qa-1' and slug='qa-original-1'
      and status='published' and adult_review_status='verified' and not adult_publish_hold)
    or (select count(*) from public.adult_verification_receipts where evidence_version=2 and evidence_state='bound')<>1
  then raise exception 'Eligible row did not publish with bound receipt and original slug: %',result; end if;
  if (select count(*) from jsonb_array_elements(result) e where e->>'status'='not-eligible')<>3
    or (select count(*) from public.profiles where status='draft' and adult_review_status='pending' and not adult_publish_hold)<>4
  then raise exception 'Changed photo, failed final guard, minor, or unselected row did not remain pending: %',result; end if;
end $$;
rollback;
select 'passed: batched receipts, storage version, partial rejection, explicit minor check, original URL, and RPC access' as result;
