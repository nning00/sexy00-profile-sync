alter table public.cities
  add column if not exists faqs jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.cities'::regclass
      and conname = 'cities_faqs_is_array'
  ) then
    alter table public.cities
      add constraint cities_faqs_is_array
      check (jsonb_typeof(faqs) = 'array');
  end if;
end $$;

