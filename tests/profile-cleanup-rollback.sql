begin;
set local statement_timeout='15s';
create temporary table test_profiles (like public.profiles including all) on commit drop;
create temporary table test_profile_images (like public.profile_images including all) on commit drop;
create temporary table test_profile_source_images (like public.profile_source_images including all) on commit drop;
create temporary table test_profile_sync_state (like public.profile_sync_state including all) on commit drop;
create temporary table test_profile_sync_lifecycle (like public.profile_sync_lifecycle including all) on commit drop;
create temporary table test_profile_sync_runs (like public.profile_sync_runs including all) on commit drop;
create temporary table test_profile_media_gc (like public.profile_media_gc including all) on commit drop;
alter table pg_temp.test_profile_sync_lifecycle add foreign key(profile_id) references pg_temp.test_profiles(id) on delete cascade;
create or replace function pg_temp.test_complete(p_keys text[],p_captured_at timestamptz,p_source_total integer,p_source_pages integer)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  n integer; baseline integer; minimum_count integer; last_capture timestamptz;
  archived_count integer:=0; deleted_count integer:=0; purge_ids uuid[]; result jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('sexy00-profile-cleanup-test',0)) then raise exception 'Cleanup is already running'; end if;
  n=coalesce(array_length(p_keys,1),0);
  if n=0 or n>50000 or p_source_total is null or p_source_pages is null or n<>p_source_total or n<>(select count(distinct k) from unnest(p_keys) k)
    or exists(select 1 from unnest(p_keys) k where k !~ '^[0-9]+$')
    or p_source_pages<>ceil(p_source_total/100.0)::integer
    or p_captured_at is null or p_captured_at>now()+interval '5 minutes' or p_captured_at<now()-interval '4 hours' then
    raise exception 'Invalid or incomplete source snapshot';
  end if;
  select s.last_capture into last_capture from pg_temp.test_profile_sync_state s where provider='edc-public-catalog';
  if p_captured_at<=last_capture then return jsonb_build_object('status','duplicate','archived',0,'deleted',0); end if;
  select greatest(count(*),coalesce((select max(source_count) from pg_temp.test_profile_sync_state),0))::integer into baseline
    from pg_temp.test_profiles where source_provider='edc-public-catalog' and status<>'archived';
  minimum_count=case when baseline>=100 then floor(baseline*0.6)::integer else greatest(1,baseline-20) end;
  if n<minimum_count then
    result=jsonb_build_object('status','blocked','reason','snapshot-count-drop','snapshotCount',n,'referenceCount',baseline,'minimumSafeCount',minimum_count,'archived',0,'deleted',0);
    insert into pg_temp.test_profile_sync_runs(provider,mode,status,summary,completed_at) values('edc-public-catalog','snapshot','blocked',result,now());
    return result;
  end if;
  -- Any matched item must have been successfully imported in this capture.
  if exists(select 1 from pg_temp.test_profiles where source_provider='edc-public-catalog' and source_key=any(p_keys)
    and (source_last_seen_at is null or source_last_seen_at<p_captured_at)) then raise exception 'Snapshot imports are incomplete'; end if;

  insert into pg_temp.test_profile_sync_lifecycle(profile_id)
    select id from pg_temp.test_profiles where source_provider='edc-public-catalog' and source_key=any(p_keys)
    on conflict(profile_id) do update set missed_snapshots=0,first_missing_at=null,archived_at=null,archived_by_cleanup=false;
  insert into pg_temp.test_profile_sync_lifecycle(profile_id,missed_snapshots,first_missing_at)
    select id,1,p_captured_at from pg_temp.test_profiles where source_provider='edc-public-catalog'
      and not(source_key=any(p_keys)) and coalesce(source_last_seen_at,'-infinity'::timestamptz)<=p_captured_at
    on conflict(profile_id) do update set missed_snapshots=pg_temp.test_profile_sync_lifecycle.missed_snapshots+1,
      first_missing_at=coalesce(pg_temp.test_profile_sync_lifecycle.first_missing_at,excluded.first_missing_at);
  with archived as (
    update pg_temp.test_profiles p set status='archived' from pg_temp.test_profile_sync_lifecycle l
    where p.id=l.profile_id and p.source_provider='edc-public-catalog' and p.status<>'archived'
      and not(p.source_key=any(p_keys)) and coalesce(p.source_last_seen_at,'-infinity'::timestamptz)<=p_captured_at
      and l.missed_snapshots>=3 and l.first_missing_at<=p_captured_at-interval '12 hours' returning p.id
  ), tagged as (
    update pg_temp.test_profile_sync_lifecycle l set archived_at=now(),archived_by_cleanup=true from archived a where l.profile_id=a.id returning l.profile_id
  ) select count(*) into archived_count from tagged;

  select array_agg(id) into purge_ids from (
    select p.id from pg_temp.test_profiles p join pg_temp.test_profile_sync_lifecycle l on l.profile_id=p.id
    where p.source_provider='edc-public-catalog' and p.status='archived' and l.archived_by_cleanup
      and l.archived_at<=now()-interval '7 days' and p.updated_at<=l.archived_at+interval '1 second'
      and not(p.source_key=any(p_keys)) and coalesce(p.source_last_seen_at,'-infinity'::timestamptz)<=p_captured_at
    order by l.archived_at,p.id limit 100 for update of p skip locked
  ) due;
  if purge_ids is not null then
    insert into pg_temp.test_profile_media_gc(path)
    select path from (
      select card_image_path as path from pg_temp.test_profiles where id=any(purge_ids)
      union select storage_path from pg_temp.test_profile_images where profile_id=any(purge_ids)
      union select storage_path from pg_temp.test_profile_source_images where profile_id=any(purge_ids)
    ) media where path ~ '^gpt-copy/profiles/[A-Za-z0-9_./-]+$' and path not like '%..%' on conflict do nothing;
    delete from pg_temp.test_profiles where id=any(purge_ids) and source_provider='edc-public-catalog';
    get diagnostics deleted_count=row_count;
  end if;
  insert into pg_temp.test_profile_sync_state(provider,last_capture,source_count) values('edc-public-catalog',p_captured_at,n)
    on conflict(provider) do update set last_capture=excluded.last_capture,source_count=excluded.source_count;
  result=jsonb_build_object('status','ready','snapshotCount',n,'referenceCount',baseline,'archived',archived_count,'deleted',deleted_count,'capture',p_captured_at);
  insert into pg_temp.test_profile_sync_runs(provider,mode,status,summary,completed_at) values('edc-public-catalog','snapshot','success',result,now());
  return result;
end; $$;


do $test$
declare r jsonb; cap timestamptz:=now()-interval '2 minutes'; test_id uuid;
begin
 insert into pg_temp.test_profiles(slug,display_name,status,source_provider,source_key,source_url,source_last_seen_at,card_image_path)
 values ('cleanup-test-a','Test A','published','edc-public-catalog','100','https://example.invalid/a',now()+interval '1 minute',null),
 ('cleanup-test-b','Test B','published','edc-public-catalog','101','https://example.invalid/b',now()+interval '1 minute',null),
 ('cleanup-test-old','Test Old','published','edc-public-catalog','102','https://example.invalid/old',now()-interval '1 day','gpt-copy/profiles/test/old.webp');
 r:=pg_temp.test_complete(array['100','101'],cap,2,1);
 if r->>'status'<>'ready' or r->>'archived'<>'0' then raise exception 'First absence must not archive'; end if;
 r:=pg_temp.test_complete(array['100','101'],cap,2,1);
 if r->>'status'<>'duplicate' or (select missed_snapshots from pg_temp.test_profile_sync_lifecycle l join pg_temp.test_profiles p on p.id=l.profile_id where p.source_key='102')<>1 then raise exception 'Duplicate capture advanced absence'; end if;
 r:=pg_temp.test_complete(array['100','101'],now()-interval '1 minute',2,1);
 if r->>'archived'<>'0' then raise exception 'Rapid captures must not archive'; end if;
 update pg_temp.test_profile_sync_lifecycle set first_missing_at=now()-interval '13 hours' where profile_id=(select id from pg_temp.test_profiles where source_key='102');
 r:=pg_temp.test_complete(array['100','101'],now(),2,1);
 if r->>'archived'<>'1' then raise exception 'Third absence across twelve hours must archive'; end if;
 r:=pg_temp.test_complete(array['100','101'],now()+interval '1 second',2,1);
 if r->>'deleted'<>'0' then raise exception 'Retention must protect recent archive'; end if;
 update pg_temp.test_profile_sync_lifecycle set archived_at=now()-interval '8 days' where profile_id=(select id from pg_temp.test_profiles where source_key='102');
 update pg_temp.test_profiles set updated_at=now()-interval '8 days',source_last_seen_at=now()-interval '10 days' where source_key='102';
 r:=pg_temp.test_complete(array['100','101'],now()+interval '2 seconds',2,1);
 if r->>'deleted'<>'1' or not exists(select 1 from pg_temp.test_profile_media_gc where path='gpt-copy/profiles/test/old.webp') then raise exception 'Expired profile must queue media and delete atomically'; end if;
 insert into pg_temp.test_profiles(slug,display_name,status,source_provider,source_key,source_url,source_last_seen_at)
 values('cleanup-test-return','Return','published','edc-public-catalog','104','https://example.invalid/return',now()+interval '3 seconds') returning id into test_id;
 insert into pg_temp.test_profile_sync_lifecycle(profile_id,missed_snapshots,first_missing_at,archived_at,archived_by_cleanup) values(test_id,5,now()-interval '9 days',now()-interval '8 days',true);
 r:=pg_temp.test_complete(array['100','101','104'],now()+interval '3 seconds',3,1);
 if not exists(select 1 from pg_temp.test_profiles where id=test_id) or (select missed_snapshots from pg_temp.test_profile_sync_lifecycle where profile_id=test_id)<>0 then raise exception 'Reappearing data must remain and reset absence'; end if;
 update pg_temp.test_profile_sync_state set source_count=1000;
 r:=pg_temp.test_complete(array['100','101','104'],now()+interval '4 seconds',3,1);
 if r->>'status'<>'blocked' then raise exception 'Incomplete snapshot must block cleanup'; end if;
 update pg_temp.test_profile_sync_state set source_count=3;
 begin
  perform pg_temp.test_complete(array[]::text[],now(),0,0);
  raise exception 'Empty catalogue was accepted';
 exception when others then if sqlerrm not like 'Invalid or incomplete%' then raise; end if; end;
 begin
  perform pg_temp.test_complete(array['100','100'],now(),2,1);
  raise exception 'Duplicate keys were accepted';
 exception when others then if sqlerrm not like 'Invalid or incomplete%' then raise; end if; end;
 begin
  perform pg_temp.test_complete(array['100','101','104'],now(),3,2);
  raise exception 'Wrong page count was accepted';
 exception when others then if sqlerrm not like 'Invalid or incomplete%' then raise; end if; end;
 update pg_temp.test_profiles set source_last_seen_at=now()-interval '1 hour' where id=test_id;
 begin
  perform pg_temp.test_complete(array['100','101','104'],now()+interval '5 seconds',3,1);
  raise exception 'Incomplete imports were accepted';
 exception when others then if sqlerrm not like 'Snapshot imports are incomplete%' then raise; end if; end;
end; $test$;
rollback;

