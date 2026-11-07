begin;
set local statement_timeout='10s';
create temporary table test_empty_profiles(like public.profiles including all) on commit drop;
create temporary table test_empty_images(like public.profile_images including all) on commit drop;
create temporary table test_empty_sources(like public.profile_source_images including all) on commit drop;
create temporary table test_empty_runs(like public.profile_sync_runs including all) on commit drop;
create or replace function pg_temp.test_remove_photoless(p_source_key text,p_captured_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare target pg_temp.test_empty_profiles%rowtype; deleted_count integer;
begin
  if p_source_key is null or p_source_key !~ '^[0-9]{1,80}$' or p_captured_at is null
    or p_captured_at>now()+interval '5 minutes' or p_captured_at<now()-interval '4 hours' then
    raise exception 'Invalid no-photo cleanup request';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('sexy00-profile-cleanup-test',0)) then raise exception 'Cleanup is already running'; end if;
  select * into target from pg_temp.test_empty_profiles where source_provider='edc-public-catalog' and source_key=p_source_key for update;
  if not found then return jsonb_build_object('action','skipped-empty','removed',0); end if;
  if target.source_last_seen_at>p_captured_at then return jsonb_build_object('action','retained-newer','removed',0); end if;
  if nullif(btrim(target.card_image_path),'') is not null
    or exists(select 1 from pg_temp.test_empty_images where profile_id=target.id)
    or exists(select 1 from pg_temp.test_empty_sources where profile_id=target.id) then
    update pg_temp.test_empty_profiles set source_last_seen_at=p_captured_at where id=target.id;
    return jsonb_build_object('action','retained-photos','removed',0);
  end if;
  delete from pg_temp.test_empty_profiles where id=target.id and source_provider='edc-public-catalog' and source_key=p_source_key;
  get diagnostics deleted_count=row_count;
  insert into pg_temp.test_empty_runs(provider,mode,status,summary,completed_at)
    values('edc-public-catalog','maintenance','success',jsonb_build_object('reason','no-source-photos','removed',deleted_count),now());
  return jsonb_build_object('action','removed','removed',deleted_count);
end; $$;

do $test$
declare r jsonb; n integer; id_gallery uuid; id_source uuid;
begin
insert into pg_temp.test_empty_profiles(slug,display_name,status,source_provider,source_key,source_url,source_last_seen_at,card_image_path)
values ('empty-test','Test empty','published','edc-public-catalog','910000001','https://edc.com.tw/test-empty/',now()-interval '1 hour',null),
('cover-test','Test cover','published','edc-public-catalog','910000002','https://edc.com.tw/test-cover/',now()-interval '1 hour','gpt-copy/profiles/test/keep.webp'),
('gallery-test','Test gallery','published','edc-public-catalog','910000003','https://edc.com.tw/test-gallery/',now()-interval '1 hour',null),
('tracking-test','Test tracking','published','edc-public-catalog','910000004','https://edc.com.tw/test-tracking/',now()-interval '1 hour',null),
('newer-test','Test newer','published','edc-public-catalog','910000005','https://edc.com.tw/test-newer/',now()+interval '1 minute',null),
('manual-test','Test manual','published',null,'910000006',null,null,null);
select id into id_gallery from pg_temp.test_empty_profiles where source_key='910000003';
select id into id_source from pg_temp.test_empty_profiles where source_key='910000004';
insert into pg_temp.test_empty_images(profile_id,storage_path,alt_text,sort_order) values(id_gallery,'gpt-copy/profiles/test/gallery.webp','Test',1);
insert into pg_temp.test_empty_sources(profile_id,source_url,storage_path,alt_text,sort_order) values(id_source,'https://edc.com.tw/test.jpg','gpt-copy/profiles/test/source.webp','Test',1);
r:=pg_temp.test_remove_photoless('910000001',now());
if r->>'action'<>'removed' or r->>'removed'<>'1' or exists(select 1 from pg_temp.test_empty_profiles where source_key='910000001') then raise exception 'Empty record not removed';end if;
r:=pg_temp.test_remove_photoless('910000001',now());
if r->>'action'<>'skipped-empty' then raise exception 'Absent record not skipped';end if;
foreach n in array array[2,3,4] loop
r:=pg_temp.test_remove_photoless('91000000'||n::text,now());
if r->>'action'<>'retained-photos' then raise exception 'Existing photos not protected';end if;
if (select source_last_seen_at from pg_temp.test_empty_profiles where source_key='91000000'||n::text)<>now() then raise exception 'Retained source capture not refreshed';end if;
end loop;
r:=pg_temp.test_remove_photoless('910000005',now());
if r->>'action'<>'retained-newer' then raise exception 'Newer profile not protected';end if;
r:=pg_temp.test_remove_photoless('910000006',now());
if r->>'action'<>'skipped-empty' or not exists(select 1 from pg_temp.test_empty_profiles where source_key='910000006') then raise exception 'Manual profile not protected';end if;
insert into pg_temp.test_empty_profiles(slug,display_name,status,source_provider,source_key,source_url,source_last_seen_at,card_image_path)
values ('return-test','Test returned photo','published','edc-public-catalog','910000001','https://edc.com.tw/test-empty/',now(),'gpt-copy/profiles/test/return.webp');
r:=pg_temp.test_remove_photoless('910000001',now());
if r->>'action'<>'retained-photos' then raise exception 'Returning photos not accepted';end if;
begin
perform pg_temp.test_remove_photoless('910000005',now()-interval '5 hours');
raise exception 'Expired request accepted';
exception when others then if sqlerrm not like 'Invalid no-photo%' then raise;end if;end;
begin
perform pg_temp.test_remove_photoless('not-a-source-key',now());
raise exception 'Malformed key accepted';
exception when others then if sqlerrm not like 'Invalid no-photo%' then raise;end if;end;
if (select count(*) from pg_temp.test_empty_profiles)<>6 then raise exception 'Protected profile count changed';end if;
end;$test$;
rollback;
