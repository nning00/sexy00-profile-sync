-- Disposable temporary fixtures only; never remove a real profile to test cleanup.
begin;
create temp table qa_profiles(id integer primary key,status text not null);
create temp table qa_receipts(id integer primary key,profile_id integer not null references qa_profiles(id) on delete cascade);
insert into qa_profiles values(1,'published'),(2,'published');
insert into qa_receipts values(1,1),(2,2);
do $$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.adult_verification_receipts'::regclass
    and confrelid='public.profiles'::regclass and contype='f' and confdeltype='c' and convalidated)
  then raise exception 'Production lifecycle foreign key missing'; end if;
  update qa_profiles set status='archived' where id=1;
  if (select count(*) from qa_receipts where profile_id=1)<>1 then raise exception 'Temporary archive erased confirmation'; end if;
  delete from qa_profiles where id=1;
  if exists(select 1 from qa_receipts where profile_id=1) then raise exception 'Permanent removal retained confirmation'; end if;
  if (select count(*) from qa_receipts where profile_id=2)<>1 then raise exception 'Unrelated confirmation changed'; end if;
  insert into qa_profiles values(1,'draft');
  if exists(select 1 from qa_receipts where profile_id=1) then raise exception 'Recreated profile inherited deleted confirmation'; end if;
end $$;
select 'passed' as lifecycle_tests,4 as scenarios,'temporary fixtures; no production rows changed' as scope;
rollback;
