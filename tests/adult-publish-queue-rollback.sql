-- Use only inside a rollback transaction. No production profiles are touched.
begin;
do $$
declare
  reviewer uuid; target uuid:=gen_random_uuid(); untouched uuid:=gen_random_uuid();
  source_key text; slug text; photo text; source_photo text:='https://example.invalid/photo';
  content_hash text:=repeat('a',64); version timestamptz; proof jsonb; result jsonb;
begin
  if has_function_privilege('anon','public.sexy00_publish_adult_draft(uuid,timestamptz,text,jsonb,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.sexy00_stage_adult_receipt(uuid,timestamptz,text,jsonb,uuid)','EXECUTE')
  then raise exception 'Review RPC is publicly accessible'; end if;
  select user_id into strict reviewer from public.admin_users order by user_id limit 1;
  foreach target in array array[target,untouched] loop
    source_key:='qa-'||target;
    slug:='qa-existing-'||target;
    photo:='gpt-copy/profiles/qa/'||target||'.jpg';
    insert into public.profiles(id,slug,display_name,status,introduction,source_provider,source_key,source_url,source_content_hash,card_image_path,adult_review_status)
    values(target,slug,'Synthetic QA','draft','{"age":""}','edc-public-catalog',source_key,'https://example.invalid/profile',content_hash,photo,'pending')
    returning updated_at into version;
    insert into public.profile_source_images(profile_id,source_url,storage_path) values(target,source_photo,photo);
    proof:=jsonb_build_array(jsonb_build_object('source_url',source_photo,'storage_path',photo,'sha256',repeat('b',64),
      'profile_snapshot',jsonb_build_object('source_key',source_key,'source_url','https://example.invalid/profile',
        'display_name','Synthetic QA','introduction','{"age":""}','city_names','[]'::jsonb)));
    begin
      perform public.sexy00_publish_adult_draft(target,version,content_hash,proof,reviewer);
      raise exception 'Pending row was published';
    exception when raise_exception then
      if sqlerrm<>'Draft not eligible for publication' then raise; end if;
    end;
    perform public.sexy00_stage_adult_receipt(target,version,content_hash,proof,reviewer);
    if not exists(select 1 from public.profiles where id=target and status='draft' and adult_review_status='verified' and adult_publish_hold)
    then raise exception 'Staging did not retain private draft'; end if;
    update public.profiles set status='published' where id=target;
    if exists(select 1 from public.profiles where id=target and status='published')
    then raise exception 'Hold allowed a separate publication'; end if;
    if target<>untouched then
      select updated_at into version from public.profiles where id=target;
      begin
        perform public.sexy00_publish_adult_draft(target,version-interval '1 second',content_hash,proof,reviewer);
        raise exception 'Stale row was published';
      exception when raise_exception then
        if sqlerrm<>'Draft not eligible for publication' then raise; end if;
      end;
      begin
        perform public.sexy00_publish_adult_draft(target,version,content_hash,jsonb_set(proof,'{0,sha256}',to_jsonb(repeat('c',64))),reviewer);
        raise exception 'Mismatched evidence was published';
      exception when raise_exception then
        if sqlerrm<>'Adult approval not valid for this version' then raise; end if;
      end;
      result:=public.sexy00_publish_adult_draft(target,version,content_hash,proof,reviewer);
      if result->>'slug' is distinct from slug or not exists(select 1 from public.profiles p where p.id=target and p.status='published' and not p.adult_publish_hold)
      then raise exception 'Publication failed to retain original slug'; end if;
    end if;
  end loop;
  if not exists(select 1 from public.profiles where id=untouched and status='draft' and adult_publish_hold)
  then raise exception 'Unselected draft changed'; end if;
end $$;
select 'passed: staging, hold, evidence, selection, original URL, and RPC access' as result;
rollback;
