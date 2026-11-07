-- sexy00.cc only. No profile rows are deleted by this schema change.
-- Fail rather than silently discard any unexpected detached receipt.
do $$
begin
  if exists(select 1 from public.adult_verification_receipts r where not exists(select 1 from public.profiles p where p.id=r.last_profile_id))
  then raise exception 'Detached receipts require separate inspection'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.adult_verification_receipts'::regclass and conname='adult_receipts_profile_fk') then
    alter table public.adult_verification_receipts add constraint adult_receipts_profile_fk
      foreign key(last_profile_id) references public.profiles(id) on delete cascade;
  end if;
end $$;
create index if not exists adult_receipts_profile_idx on public.adult_verification_receipts(last_profile_id);
