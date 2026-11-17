-- sexy00.cc / kkxsclcqdxoiqucunpur only. The queue does not change any existing approval.
begin;
alter table public.profiles add column if not exists adult_publish_hold boolean not null default false;

create or replace function private.sexy00_hold_reviewed_draft()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.adult_publish_hold and new.status='published' then new.status:='draft'; end if;
  return new;
end $$;
revoke all on function private.sexy00_hold_reviewed_draft() from public,anon,authenticated;
create or replace trigger sexy00_hold_reviewed_draft before insert or update of status,adult_publish_hold on public.profiles
for each row execute function private.sexy00_hold_reviewed_draft();

create or replace function public.sexy00_stage_adult_receipt(
  p_profile_id uuid,p_expected_updated_at timestamptz,p_expected_hash text,p_photos jsonb,p_reviewer uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform pg_advisory_xact_lock(hashtext('sexy00-profile-cleanup'));
  if p_reviewer is null then raise exception 'Reviewer required'; end if;
  update public.profiles set adult_publish_hold=true
  where id=p_profile_id and source_provider='edc-public-catalog' and status='draft' and adult_review_status='pending'
    and updated_at=p_expected_updated_at and source_content_hash=p_expected_hash;
  if not found then raise exception 'Draft changed during review'; end if;
  return public.sexy00_save_adult_receipt(p_profile_id,p_expected_hash,p_photos,p_reviewer,2);
end $$;
revoke all on function public.sexy00_stage_adult_receipt(uuid,timestamptz,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sexy00_stage_adult_receipt(uuid,timestamptz,text,jsonb,uuid) to service_role;

create or replace function public.sexy00_publish_adult_draft(
  p_profile_id uuid,p_expected_updated_at timestamptz,p_expected_hash text,p_photos jsonb,p_publisher uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare p public.profiles%rowtype; hashes text[]; n int;
begin
  if not exists(select 1 from public.admin_users where user_id=p_publisher) then raise exception 'Publisher required'; end if;
  perform pg_advisory_xact_lock(hashtext('sexy00-profile-cleanup'));
  select * into p from public.profiles where id=p_profile_id and source_provider='edc-public-catalog' for update;
  if not found or p.status<>'draft' or not p.adult_publish_hold or p.adult_review_status<>'verified'
    or p.adult_verified_by is null or p.adult_verified_at is null or p.updated_at is distinct from p_expected_updated_at
    or p.source_content_hash is distinct from p_expected_hash or p_expected_hash is null
    or coalesce(p.introduction::jsonb->>'age','') ~* '^\s*(1[0-7]|[0-9])\s*(歲|岁|years?\s*old)?\s*$'
  then raise exception 'Draft not eligible for publication'; end if;
  perform 1 from public.profile_source_images where profile_id=p.id for update;
  perform 1 from public.profile_cities where profile_id=p.id for update;
  perform 1 from public.profile_images where profile_id=p.id for update;
  select count(*) into n from public.profile_source_images where profile_id=p.id;
  if jsonb_typeof(p_photos) is distinct from 'array' or n not between 1 and 3 or jsonb_array_length(p_photos)<>n
    or not exists(select 1 from public.profile_source_images i where i.profile_id=p.id and i.storage_path=p.card_image_path)
    or exists(select 1 from public.profile_images g where g.profile_id=p.id and not exists(
      select 1 from public.profile_source_images i where i.profile_id=p.id and i.storage_path=g.storage_path))
    or exists(select 1 from public.profile_source_images i where i.profile_id=p.id and not exists(
      select 1 from jsonb_array_elements(p_photos) j where j->>'source_url'=i.source_url and j->>'storage_path'=i.storage_path))
    or not coalesce(p_photos->0->'profile_snapshot'=jsonb_build_object('source_key',p.source_key,'source_url',p.source_url,
      'display_name',p.display_name,'introduction',p.introduction,'city_names',
      (select coalesce(jsonb_agg(c.name order by c.name),'[]'::jsonb) from public.profile_cities pc join public.cities c on c.id=pc.city_id where pc.profile_id=p.id)),false)
  then raise exception 'Photo evidence changed during review'; end if;
  select array_agg(j->>'sha256' order by j->>'sha256') into hashes from jsonb_array_elements(p_photos) j;
  perform 1 from public.adult_verification_receipts r where r.source_provider=p.source_provider and r.source_key=p.source_key
    and r.content_hash=p.source_content_hash and r.last_profile_id=p.id and r.verified_by=p.adult_verified_by
    and r.verified_at=p.adult_verified_at and r.evidence_state='bound' and r.evidence_version=2
    and r.revoked_at is null and r.photo_hashes=hashes for update;
  if not found then raise exception 'Adult approval not valid for this version'; end if;
  update public.profiles set status='published',adult_publish_hold=false where id=p.id;
  return jsonb_build_object('slug',p.slug);
end $$;
revoke all on function public.sexy00_publish_adult_draft(uuid,timestamptz,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sexy00_publish_adult_draft(uuid,timestamptz,text,jsonb,uuid) to service_role;

-- Only the trusted Worker can read Storage versions or submit batch proofs.
create or replace function public.sexy00_adult_review_media_versions(p_paths text[])
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
begin
  if cardinality(p_paths) is null or cardinality(p_paths) not between 1 and 24
    or exists(select 1 from unnest(p_paths) as q(path)
      where q.path is null or q.path !~ '^gpt-copy/profiles/[A-Za-z0-9_./-]+$' or strpos(q.path,'..')>0)
  then raise exception 'Invalid photo paths'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('storage_path',o.name,'object_id',o.id,
    'revision',o.version,'updated_at',o.updated_at)),'[]'::jsonb)
    from storage.objects o where o.bucket_id='site-media' and o.name=any(p_paths) and o.version is not null);
end $$;
revoke all on function public.sexy00_adult_review_media_versions(text[]) from public,anon,authenticated;
grant execute on function public.sexy00_adult_review_media_versions(text[]) to service_role;

-- Each eligible draft advances from pending to published inside the same
-- transaction. A rejected row also rolls back its staged receipt and hold.
create or replace function public.sexy00_confirm_publish_adult_batch(p_records jsonb,p_reviewer uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare item jsonb; pid uuid; proof jsonb; version_at timestamptz; staged_version timestamptz;
  sha text; check_result jsonb; result jsonb:='[]'::jsonb; reason text; matched integer;
begin
  if not exists(select 1 from public.admin_users where user_id=p_reviewer) then raise exception 'Reviewer required'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' then raise exception 'Invalid batch'; end if;
  if jsonb_array_length(p_records) not between 1 and 8 or
    (select count(distinct (r->>'id')::uuid) from jsonb_array_elements(p_records) r)<>jsonb_array_length(p_records)
  then raise exception 'Invalid batch'; end if;
  perform pg_advisory_xact_lock(hashtext('sexy00-profile-cleanup'));
  for item in select value from jsonb_array_elements(p_records) loop
    pid:=(item->>'id')::uuid;
    version_at:=(item->>'version')::timestamptz;
    sha:=item->>'hash';
    proof:=item->'photos';
    if version_at is null or sha is null or sha !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(proof) is distinct from 'array' then raise exception 'Invalid proof'; end if;
    if jsonb_array_length(proof) not between 1 and 3 or exists(select 1 from jsonb_array_elements(proof) j
      where coalesce(j->>'storage_path','') !~ '^gpt-copy/profiles/[A-Za-z0-9_./-]+$'
        or strpos(j->>'storage_path','..')>0 or coalesce(j->>'sha256','') !~ '^[a-f0-9]{64}$'
        or coalesce(j->>'revision','')='' or j->>'object_id' is null or j->>'updated_at' is null)
    then raise exception 'Invalid proof'; end if;
    begin
      -- Serialize object replacement across the final proof check and commit.
      -- A user-supplied path or cached checksum is never sufficient.
      perform 1 from storage.objects o join jsonb_array_elements(proof) j
        on o.id=(j->>'object_id')::uuid and o.name=j->>'storage_path'
        and o.version=j->>'revision' and o.updated_at=(j->>'updated_at')::timestamptz
        where o.bucket_id='site-media' order by o.id for share of o;
      get diagnostics matched=row_count;
      if matched<>jsonb_array_length(proof) then raise exception 'Storage revision changed'; end if;
      check_result:=public.sexy00_stage_adult_receipt(pid,version_at,sha,proof,p_reviewer);
      if check_result->'bound' is distinct from 'true'::jsonb then raise exception 'Receipt not bound'; end if;
      select updated_at into strict staged_version from public.profiles where id=pid;
      check_result:=public.sexy00_publish_adult_draft(pid,staged_version,sha,proof,p_reviewer);
      if coalesce(check_result->>'slug','')='' then raise exception 'Unknown publishing outcome'; end if;
      result:=result||jsonb_build_array(jsonb_build_object('id',pid,'status','published','slug',check_result->>'slug'));
    exception when raise_exception then
      get stacked diagnostics reason=message_text;
      if reason not in ('Storage revision changed','Draft changed during review','Profile changed during review',
        'Invalid manual review','Source explicitly reports a minor','Photo evidence changed during review',
        'Draft not eligible for publication','Adult approval not valid for this version','Receipt not bound') then raise; end if;
      result:=result||jsonb_build_array(jsonb_build_object('id',pid,'status','not-eligible'));
    end;
  end loop;
  return result;
end $$;
revoke all on function public.sexy00_confirm_publish_adult_batch(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sexy00_confirm_publish_adult_batch(jsonb,uuid) to service_role;
commit;
