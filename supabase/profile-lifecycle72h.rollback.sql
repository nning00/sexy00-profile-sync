-- Safe fallback, deliberately NOT restoring legacy permanent deletion.
CREATE OR REPLACE FUNCTION public.sexy00_complete_profile_snapshot(p_keys text[], p_captured_at timestamp with time zone, p_source_total integer, p_source_pages integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  n integer; baseline integer; minimum_count integer; last_capture timestamptz;
  archived_count integer:=0; deleted_count integer:=0; purge_ids uuid[]; result jsonb; held_ids uuid[]; held_hash text; extra_ids uuid[]; extra_hash text; new_ids uuid[]; new_hash text;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('sexy00-profile-cleanup',0)) then raise exception 'Cleanup is already running'; end if;
  -- Pinned fixed manifest. Copy once, verify, then reuse the same array.
  select array_agg(profile_id order by profile_id),
    encode(sha256(convert_to(string_agg(profile_id::text,E'\n' order by profile_id),'UTF8')),'hex')
    into held_ids, held_hash from private.sexy00_purge_hold309;
  if coalesce(cardinality(held_ids),0)<>309 or held_hash is distinct from 'a3cf82662fce2750331bd3faeeb2b31e08d8bd39662997ff1fa7fe9f66d40f17' then
    raise exception 'Fixed purge hold manifest is unavailable or inconsistent' using errcode='P0001';
  end if;
  -- Independent additional fixed manifest. Original309 check remains unchanged.
  select array_agg(profile_id order by profile_id),
    encode(sha256(convert_to(string_agg(profile_id::text,chr(10) order by profile_id),'UTF8')),'hex')
    into extra_ids, extra_hash from private.sexy00_purge_hold688;
  if coalesce(cardinality(extra_ids),0)<>688 or extra_hash is distinct from 'f671132dc61ee10c96da33fa19c3cb45aac44722c12225f351f39d2960824a91' then
    raise exception 'Additional fixed purge hold manifest is unavailable or inconsistent' using errcode='P0001';
  end if;
  if held_ids && extra_ids then raise exception 'Hold manifests overlap'; end if;
  select array_agg(profile_id order by profile_id), encode(sha256(convert_to(string_agg(profile_id::text,chr(10) order by profile_id),'UTF8')),'hex') into new_ids,new_hash from private.sexy00_purge_hold538;
  if coalesce(cardinality(new_ids),0)<>538 or new_hash is distinct from 'acaf55107ff512d127036e4e46a02fa388b0dcde59b7808e73dd68157b94dc9c' then raise exception 'Fixed538 manifest is unavailable or inconsistent'; end if;
  if new_ids && held_ids or new_ids && extra_ids then raise exception 'Hold manifests overlap'; end if;
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

  -- Safe fallback: retain prior delayed archive rule but never purge rows/media.
  insert into public.profile_sync_state(provider,last_capture,source_count) values('edc-public-catalog',p_captured_at,n)
    on conflict(provider) do update set last_capture=excluded.last_capture,source_count=excluded.source_count;
  result=jsonb_build_object('status','ready','snapshotCount',n,'referenceCount',baseline,'archived',archived_count,'deleted',deleted_count,'capture',p_captured_at);
  insert into public.profile_sync_runs(provider,mode,status,summary,completed_at) values('edc-public-catalog','snapshot','success',result,now());
  return result;
end; $function$;
