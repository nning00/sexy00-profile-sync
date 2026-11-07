-- sexy00.cc only. No FK to profiles: profile cleanup must not erase manual receipts.
create table public.adult_verification_receipts (
  source_provider text not null check (source_provider='edc-public-catalog'),
  source_key text not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  photo_hashes text[] not null default '{}',
  verified_at timestamptz not null,
  verified_by uuid not null,
  last_profile_id uuid not null,
  evidence_state text not null check(evidence_state in ('legacy-unbound','bound','insufficient-evidence')),
  revoked_at timestamptz,
  primary key(source_provider,source_key,content_hash)
);
alter table public.adult_verification_receipts enable row level security;
revoke all on public.adult_verification_receipts from public,anon,authenticated;
grant select,insert,update on public.adult_verification_receipts to service_role;

-- Preserve only actual manual approvals. No source-derived or pending approval is created.
insert into public.adult_verification_receipts(source_provider,source_key,content_hash,verified_at,verified_by,last_profile_id,evidence_state)
select source_provider,source_key,source_content_hash,adult_verified_at,adult_verified_by,id,'legacy-unbound'
from public.profiles where source_provider='edc-public-catalog' and adult_review_status='verified'
and adult_verified_at is not null and adult_verified_by is not null and source_content_hash ~ '^[a-f0-9]{64}$';

create or replace function public.sexy00_save_adult_receipt(p_profile_id uuid,p_expected_hash text,p_photos jsonb,p_reviewer uuid default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype; n integer; hashes text[]; can_bind boolean; at_time timestamptz; by_user uuid;
begin
  -- Serialize against automatic deletion and against another approval of this row.
  perform pg_advisory_xact_lock(hashtext('sexy00-profile-cleanup'));
  select * into p from public.profiles where id=p_profile_id and source_provider='edc-public-catalog' for update;
  if not found or p.source_content_hash is distinct from p_expected_hash or p_expected_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'Profile changed during review'; end if;
  if p_reviewer is not null then
    if not exists(select 1 from public.admin_users where user_id=p_reviewer) or p.adult_review_status<>'pending'
    then raise exception 'Invalid manual review'; end if;
    -- Explicit minor ages cannot be overridden by a retained/manual receipt.
    if coalesce(p.introduction::jsonb->>'age','') ~* '^\s*(1[0-7]|[0-9])\s*(歲|岁|years?\s*old)?\s*$'
    then raise exception 'Source explicitly reports a minor'; end if;
    at_time:=clock_timestamp(); by_user:=p_reviewer;
  else
    if p.adult_review_status<>'verified' or p.adult_verified_by is null or p.adult_verified_at is null
    then raise exception 'No existing manual approval'; end if;
    at_time:=p.adult_verified_at; by_user:=p.adult_verified_by;
  end if;
  perform 1 from public.profile_source_images where profile_id=p.id for update;
  select count(*) into n from public.profile_source_images where profile_id=p.id;
  if jsonb_typeof(p_photos) is distinct from 'array' then raise exception 'Invalid photo evidence'; end if;
  can_bind:=n between 1 and 3 and jsonb_array_length(p_photos)=n
    and not exists(select 1 from jsonb_array_elements(p_photos) j where coalesce(j->>'sha256','') !~ '^[a-f0-9]{64}$')
    and not exists(select 1 from public.profile_source_images i where i.profile_id=p.id and
      not exists(select 1 from jsonb_array_elements(p_photos) j where j->>'source_url'=i.source_url and j->>'storage_path'=i.storage_path))
    and (p_reviewer is not null or not exists(select 1 from public.profile_source_images i where i.profile_id=p.id and i.created_at>at_time));
  if p_reviewer is not null and not can_bind then raise exception 'Photo evidence changed during review'; end if;
  select coalesce(array_agg(j->>'sha256' order by j->>'sha256'),'{}') into hashes from jsonb_array_elements(p_photos) j;
  insert into public.adult_verification_receipts(source_provider,source_key,content_hash,photo_hashes,verified_at,verified_by,last_profile_id,evidence_state)
  values(p.source_provider,p.source_key,p_expected_hash,case when can_bind then hashes else '{}' end,at_time,by_user,p.id,case when can_bind then 'bound' else 'insufficient-evidence' end)
  on conflict(source_provider,source_key,content_hash) do update set photo_hashes=excluded.photo_hashes,verified_at=excluded.verified_at,
    verified_by=excluded.verified_by,last_profile_id=excluded.last_profile_id,evidence_state=excluded.evidence_state,
    revoked_at=case when p_reviewer is not null then null else public.adult_verification_receipts.revoked_at end;
  if p_reviewer is not null then
    update public.profiles set adult_review_status='verified',adult_verified_at=at_time,adult_verified_by=by_user,status='published' where id=p.id;
  end if;
  return jsonb_build_object('saved',true,'bound',can_bind);
end $$;
revoke all on function public.sexy00_save_adult_receipt(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sexy00_save_adult_receipt(uuid,text,jsonb,uuid) to service_role;

-- Admin profile edits use the authenticated role, which deliberately cannot
-- access receipts. This narrow private trigger can only revoke (never approve).
create or replace function private.sexy00_revoke_adult_receipts()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if old.source_provider='edc-public-catalog' and (
    new.adult_review_status='rejected' and old.adult_review_status is distinct from 'rejected'
    or new.adult_review_status='pending' and old.adult_review_status='verified') then
    update public.adult_verification_receipts set revoked_at=clock_timestamp()
    where source_provider=old.source_provider and source_key=old.source_key and revoked_at is null;
  end if;
  return new;
end $$;
revoke all on function private.sexy00_revoke_adult_receipts() from public,anon,authenticated;
create trigger sexy00_revoke_adult_receipts after update of adult_review_status on public.profiles
for each row execute function private.sexy00_revoke_adult_receipts();
