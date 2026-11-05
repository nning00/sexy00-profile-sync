create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.admin_users where user_id = (select auth.uid()));
$$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated, service_role;

alter table public.admin_users enable row level security;
alter table public.regions enable row level security;
alter table public.cities enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_images enable row level security;
alter table public.profile_cities enable row level security;
alter table public.profile_source_images enable row level security;
alter table public.profile_sync_runs enable row level security;
alter table public.article_categories enable row level security;
alter table public.articles enable row level security;
alter table public.article_images enable row level security;
alter table public.site_settings enable row level security;

create policy admin_self_read on public.admin_users for select to authenticated using (user_id = (select auth.uid()));
create policy public_read_regions on public.regions for select to anon using (published);
create policy public_read_cities on public.cities for select to anon using (published);
create policy public_read_profiles on public.profiles for select to anon using (status = 'published' and adult_review_status = 'verified');
create policy public_read_profile_images on public.profile_images for select to anon using (
  exists (
    select 1 from public.profiles
    where profiles.id = profile_images.profile_id
      and profiles.status = 'published'
      and profiles.adult_review_status = 'verified'
  )
);
create policy public_read_profile_cities on public.profile_cities for select to anon using (
  exists (
    select 1 from public.profiles
    where profiles.id = profile_cities.profile_id
      and profiles.status = 'published'
      and profiles.adult_review_status = 'verified'
  )
);
create policy public_read_categories on public.article_categories for select to anon using (published);
create policy public_read_articles on public.articles for select to anon using (status = 'published');
create policy public_read_article_images on public.article_images for select to anon using (
  exists (
    select 1 from public.articles
    where articles.id = article_images.article_id
      and articles.status = 'published'
  )
);
create policy public_read_settings on public.site_settings for select to anon using (true);

create policy admin_all_regions on public.regions for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_cities on public.cities for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_profiles on public.profiles for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_profile_images on public.profile_images for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_profile_cities on public.profile_cities for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_source_images on public.profile_source_images for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_sync_runs on public.profile_sync_runs for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_categories on public.article_categories for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_articles on public.articles for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_article_images on public.article_images for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_settings on public.site_settings for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy admin_select_media on storage.objects for select to authenticated using (bucket_id = 'site-media' and private.is_admin());
create policy admin_insert_media on storage.objects for insert to authenticated with check (bucket_id = 'site-media' and private.is_admin());
create policy admin_update_media on storage.objects for update to authenticated using (bucket_id = 'site-media' and private.is_admin()) with check (bucket_id = 'site-media' and private.is_admin());
create policy admin_delete_media on storage.objects for delete to authenticated using (bucket_id = 'site-media' and private.is_admin());

create or replace function public.save_profile_with_cities(
  p_profile_id uuid,
  p_slug text,
  p_display_name text,
  p_style text,
  p_interest text,
  p_introduction text,
  p_card_image_path text,
  p_status text,
  p_sort_order integer,
  p_seo_title text,
  p_seo_description text,
  p_adult_review_status text,
  p_city_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if not private.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  if p_profile_id is null then
    insert into public.profiles (
      slug, display_name, style, interest, introduction, card_image_path,
      status, sort_order, seo_title, seo_description, adult_review_status
    ) values (
      p_slug, p_display_name, p_style, p_interest, p_introduction, p_card_image_path,
      p_status, p_sort_order, p_seo_title, p_seo_description, p_adult_review_status
    ) returning id into saved_id;
  else
    update public.profiles
    set slug = p_slug,
        display_name = p_display_name,
        style = p_style,
        interest = p_interest,
        introduction = p_introduction,
        card_image_path = p_card_image_path,
        status = p_status,
        sort_order = p_sort_order,
        seo_title = p_seo_title,
        seo_description = p_seo_description,
        adult_review_status = p_adult_review_status
    where id = p_profile_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'profile not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.profile_cities (profile_id, city_id)
  select saved_id, city_id
  from unnest(coalesce(p_city_ids, '{}'::uuid[])) as city_id
  on conflict (profile_id, city_id) do nothing;

  delete from public.profile_cities
  where profile_id = saved_id
    and not (city_id = any(coalesce(p_city_ids, '{}'::uuid[])));

  return saved_id;
end;
$$;

revoke all on function public.save_profile_with_cities(uuid, text, text, text, text, text, text, text, integer, text, text, text, uuid[]) from public, anon;
grant execute on function public.save_profile_with_cities(uuid, text, text, text, text, text, text, text, integer, text, text, text, uuid[]) to authenticated;

select 'security-ready' as result;
