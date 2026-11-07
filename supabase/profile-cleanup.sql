-- sexy00-only cleanup schema. Never deletes Storage metadata directly.
create table if not exists public.profile_sync_state (
  provider text primary key check (provider = 'edc-public-catalog'),
  last_capture timestamptz not null,
  source_count integer not null check (source_count > 0)
);
create table if not exists public.profile_sync_lifecycle (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  missed_snapshots integer not null default 0 check (missed_snapshots >= 0),
  first_missing_at timestamptz,
  archived_at timestamptz,
  archived_by_cleanup boolean not null default false
);
create index if not exists profile_sync_lifecycle_purge_idx on public.profile_sync_lifecycle(archived_at) where archived_by_cleanup;
create table if not exists public.profile_media_gc (
  path text primary key check (path ~ '^gpt-copy/profiles/[A-Za-z0-9_./-]+$' and path not like '%..%'),
  queued_at timestamptz not null default now(),
  not_before timestamptz not null default (now() + interval '24 hours')
);
create index if not exists profile_media_gc_due_idx on public.profile_media_gc(not_before,path);
alter table public.profile_sync_state enable row level security;
alter table public.profile_sync_lifecycle enable row level security;
alter table public.profile_media_gc enable row level security;
revoke all on public.profile_sync_state,public.profile_sync_lifecycle,public.profile_media_gc from public,anon,authenticated;
grant all on public.profile_sync_state,public.profile_sync_lifecycle,public.profile_media_gc to service_role;

create or replace function public.sexy00_media_referenced(p_path text)
returns boolean language sql stable security invoker set search_path = pg_catalog, public as $$
  select exists(select 1 from public.profiles where card_image_path=p_path)
    or exists(select 1 from public.profile_images where storage_path=p_path)
    or exists(select 1 from public.profile_source_images where storage_path=p_path)
    or exists(select 1 from public.articles where cover_image_path=p_path
      or position(p_path in replace(replace(content::text,'%2F','/'),'%2f','/'))>0)
    or exists(select 1 from public.article_images where storage_path=p_path)
    or exists(select 1 from public.regions where image_path=p_path)
    or exists(select 1 from public.site_settings where position(p_path in replace(replace(value::text,'%2F','/'),'%2f','/'))>0);
$$;

create or replace function public.sexy00_queue_orphan_media()
returns integer language plpgsql security invoker set search_path = pg_catalog, public as $$
declare n integer;
begin
  insert into public.profile_media_gc(path)
  with directly_referenced as materialized (
    select card_image_path as path from public.profiles where card_image_path is not null
    union select storage_path from public.profile_images
    union select storage_path from public.profile_source_images
    union select cover_image_path from public.articles where cover_image_path is not null
    union select storage_path from public.article_images
    union select image_path from public.regions where image_path is not null
  ), candidates as materialized (
    select o.name from storage.objects o
    where o.bucket_id='site-media' and o.name ~ '^gpt-copy/profiles/[A-Za-z0-9_./-]+$'
      and o.name not like '%..%' and o.created_at < now()-interval '24 hours'
      and not exists(select 1 from public.profile_media_gc g where g.path=o.name)
      and not exists(select 1 from directly_referenced r where r.path=o.name)
    order by o.name limit 500
  )
  select name from candidates where not public.sexy00_media_referenced(name)
  on conflict do nothing;
  get diagnostics n=row_count;
  return n;
end; $$;

create or replace function public.sexy00_complete_profile_snapshot(p_keys text[],p_captured_at timestamptz,p_source_total integer,p_source_pages integer)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  n integer; baseline integer; minimum_count integer; last_capture timestamptz;
  archived_count integer:=0; deleted_count integer:=0; purge_ids uuid[]; result jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('sexy00-profile-cleanup',0)) then raise exception 'Cleanup is already running'; end if;
  n=coalesce(array_length(p_keys,1),0);
  if n=0 or n>50000 or p_source_total is null or p_source_pages is null or n<>p_source_total or n<>(select count(distinct k) from unnest(p_keys) k)
    or exists(select 1 from unnest(p_keys) k where k !~ '^[0-9]+$')
    or p_source_pages<>ceil(p_source_total/100.0)::integer
    or p_captured_at is null or p_captured_at>now()+interval '5 minutes' or p_captured_at<now()-interval '4 hours' then
    raise exception 'Invalid or incomplete source snapshot';
  end if;
  select s.last_capture into last_capture from public.profile_sync_state s where provider='edc-public-catalog';
  if p_captured_at<=last_capture then return jsonb_build_object('status','duplicate','archived',0,'deleted',0); end if;
  select greatest(count(*),coalesce((select max(source_count) from public.profile_sync_state),0))::integer into baseline
    from public.profiles where source_provider='edc-public-catalog' and status<>'archived';
  minimum_count=case when baseline>=100 then floor(baseline*0.6)::integer else greatest(1,baseline-20) end;
  if n<minimum_count then
    result=jsonb_build_object('status','blocked','reason','snapshot-count-drop','snapshotCount',n,'referenceCount',baseline,'minimumSafeCount',minimum_count,'archived',0,'deleted',0);
    insert into public.profile_sync_runs(provider,mode,status,summary,completed_at) values('edc-public-catalog','snapshot','blocked',result,now());
    return result;
  end if;
  -- Any matched item must have been successfully imported in this capture.
  if exists(select 1 from public.profiles where source_provider='edc-public-catalog' and source_key=any(p_keys)
    and (source_last_seen_at is null or source_last_seen_at<p_captured_at)) then raise exception 'Snapshot imports are incomplete'; end if;

  insert into public.profile_sync_lifecycle(profile_id)
    select id from public.profiles where source_provider='edc-public-catalog' and source_key=any(p_keys)
    on conflict(profile_id) do update set missed_snapshots=0,first_missing_at=null,archived_at=null,archived_by_cleanup=false;
  insert into public.profile_sync_lifecycle(profile_id,missed_snapshots,first_missing_at)
    select id,1,p_captured_at from public.profiles where source_provider='edc-public-catalog'
      and not(source_key=any(p_keys)) and coalesce(source_last_seen_at,'-infinity'::timestamptz)<=p_captured_at
    on conflict(profile_id) do update set missed_snapshots=public.profile_sync_lifecycle.missed_snapshots+1,
      first_missing_at=coalesce(public.profile_sync_lifecycle.first_missing_at,excluded.first_missing_at);
  with archived as (
    update public.profiles p set status='archived' from public.profile_sync_lifecycle l
    where p.id=l.profile_id and p.source_provider='edc-public-catalog' and p.status<>'archived'
      and not(p.source_key=any(p_keys)) and coalesce(p.source_last_seen_at,'-infinity'::timestamptz)<=p_captured_at
      and l.missed_snapshots>=3 and l.first_missing_at<=p_captured_at-interval '12 hours' returning p.id
  ), tagged as (
    update public.profile_sync_lifecycle l set archived_at=now(),archived_by_cleanup=true from archived a where l.profile_id=a.id returning l.profile_id
  ) select count(*) into archived_count from tagged;

  select array_agg(id) into purge_ids from (
    select p.id from public.profiles p join public.profile_sync_lifecycle l on l.profile_id=p.id
    where p.source_provider='edc-public-catalog' and p.status='archived' and l.archived_by_cleanup
      and l.archived_at<=now()-interval '7 days' and p.updated_at<=l.archived_at+interval '1 second'
      and not(p.source_key=any(p_keys)) and coalesce(p.source_last_seen_at,'-infinity'::timestamptz)<=p_captured_at
    order by l.archived_at,p.id limit 100 for update of p skip locked
  ) due;
  if purge_ids is not null then
    insert into public.profile_media_gc(path)
    select path from (
      select card_image_path as path from public.profiles where id=any(purge_ids)
      union select storage_path from public.profile_images where profile_id=any(purge_ids)
      union select storage_path from public.profile_source_images where profile_id=any(purge_ids)
    ) media where path ~ '^gpt-copy/profiles/[A-Za-z0-9_./-]+$' and path not like '%..%' on conflict do nothing;
    delete from public.profiles where id=any(purge_ids) and source_provider='edc-public-catalog';
    get diagnostics deleted_count=row_count;
  end if;
  insert into public.profile_sync_state(provider,last_capture,source_count) values('edc-public-catalog',p_captured_at,n)
    on conflict(provider) do update set last_capture=excluded.last_capture,source_count=excluded.source_count;
  result=jsonb_build_object('status','ready','snapshotCount',n,'referenceCount',baseline,'archived',archived_count,'deleted',deleted_count,'capture',p_captured_at);
  insert into public.profile_sync_runs(provider,mode,status,summary,completed_at) values('edc-public-catalog','snapshot','success',result,now());
  return result;
end; $$;

revoke all on function public.sexy00_media_referenced(text),public.sexy00_queue_orphan_media(),public.sexy00_complete_profile_snapshot(text[],timestamptz,integer,integer) from public,anon,authenticated;
grant execute on function public.sexy00_media_referenced(text),public.sexy00_queue_orphan_media(),public.sexy00_complete_profile_snapshot(text[],timestamptz,integer,integer) to service_role;

create or replace function public.sexy00_gc_allowed(p_paths text[])
returns table(path text) language sql stable security invoker set search_path=pg_catalog,public as $$
  select g.path from public.profile_media_gc g where g.path=any(p_paths)
    and g.not_before<=now() and not public.sexy00_media_referenced(g.path)
    order by g.path limit 100;
$$;
revoke all on function public.sexy00_gc_allowed(text[]) from public,anon,authenticated;
grant execute on function public.sexy00_gc_allowed(text[]) to service_role;

-- Called only after an authenticated sync supplied an explicit empty image
-- array. A row lock and fresh child checks protect concurrently added photos.
create or replace function public.sexy00_remove_photoless_profile(p_source_key text,p_captured_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare target public.profiles%rowtype; deleted_count integer;
begin
  if p_source_key is null or p_source_key !~ '^[0-9]{1,80}$' or p_captured_at is null
    or p_captured_at>now()+interval '5 minutes' or p_captured_at<now()-interval '4 hours' then
    raise exception 'Invalid no-photo cleanup request';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('sexy00-profile-cleanup',0)) then raise exception 'Cleanup is already running'; end if;
  select * into target from public.profiles where source_provider='edc-public-catalog' and source_key=p_source_key for update;
  if not found then return jsonb_build_object('action','skipped-empty','removed',0); end if;
  if target.source_last_seen_at>p_captured_at then return jsonb_build_object('action','retained-newer','removed',0); end if;
  if nullif(btrim(target.card_image_path),'') is not null
    or exists(select 1 from public.profile_images where profile_id=target.id)
    or exists(select 1 from public.profile_source_images where profile_id=target.id) then
    update public.profiles set source_last_seen_at=p_captured_at where id=target.id;
    return jsonb_build_object('action','retained-photos','removed',0);
  end if;
  delete from public.profiles where id=target.id and source_provider='edc-public-catalog' and source_key=p_source_key;
  get diagnostics deleted_count=row_count;
  insert into public.profile_sync_runs(provider,mode,status,summary,completed_at)
    values('edc-public-catalog','maintenance','success',jsonb_build_object('reason','no-source-photos','removed',deleted_count),now());
  return jsonb_build_object('action','removed','removed',deleted_count);
end; $$;
revoke all on function public.sexy00_remove_photoless_profile(text,timestamptz) from public,anon,authenticated;
grant execute on function public.sexy00_remove_photoless_profile(text,timestamptz) to service_role;
