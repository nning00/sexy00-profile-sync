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
commit;
