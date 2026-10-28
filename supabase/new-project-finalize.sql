create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.admin_users where user_id = (select auth.uid()));
$$;

grant execute on function public.is_admin() to anon, authenticated;

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
create policy public_read_regions on public.regions for select to anon, authenticated using (published or public.is_admin());
create policy public_read_cities on public.cities for select to anon, authenticated using (published or public.is_admin());
create policy public_read_profiles on public.profiles for select to anon, authenticated using ((status = 'published' and adult_review_status = 'verified') or public.is_admin());
create policy public_read_profile_images on public.profile_images for select to anon, authenticated using (true);
create policy public_read_profile_cities on public.profile_cities for select to anon, authenticated using (true);
create policy public_read_categories on public.article_categories for select to anon, authenticated using (published or public.is_admin());
create policy public_read_articles on public.articles for select to anon, authenticated using (status = 'published' or public.is_admin());
create policy public_read_article_images on public.article_images for select to anon, authenticated using (true);
create policy public_read_settings on public.site_settings for select to anon, authenticated using (true);

create policy admin_all_regions on public.regions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_cities on public.cities for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_profiles on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_profile_images on public.profile_images for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_profile_cities on public.profile_cities for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_source_images on public.profile_source_images for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_sync_runs on public.profile_sync_runs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_categories on public.article_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_articles on public.articles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_article_images on public.article_images for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all_settings on public.site_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy public_read_media on storage.objects for select to anon, authenticated using (bucket_id = 'site-media');
create policy admin_insert_media on storage.objects for insert to authenticated with check (bucket_id = 'site-media' and public.is_admin());
create policy admin_update_media on storage.objects for update to authenticated using (bucket_id = 'site-media' and public.is_admin()) with check (bucket_id = 'site-media' and public.is_admin());
create policy admin_delete_media on storage.objects for delete to authenticated using (bucket_id = 'site-media' and public.is_admin());

select 'security-ready' as result;
