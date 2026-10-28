create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  english_name text,
  summary text,
  image_path text,
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions(id) on delete cascade,
  slug text not null,
  name text not null,
  summary text,
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  page_title text,
  gallery_title text,
  gallery_description text,
  seo_title text,
  seo_description text,
  unique(region_id, slug)
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  style text,
  interest text,
  introduction text,
  card_image_path text,
  status text not null default 'draft',
  sort_order integer not null default 0,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_provider text,
  source_key text,
  source_url text,
  source_content_hash text,
  source_last_seen_at timestamptz,
  adult_review_status text not null default 'verified',
  adult_verified_at timestamptz,
  adult_verified_by uuid,
  unique(source_provider, source_key)
);

create table if not exists public.profile_images (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.profile_cities (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  city_id uuid not null references public.cities(id) on delete cascade,
  primary key(profile_id, city_id)
);

create table if not exists public.profile_source_images (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source_url text not null,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key(profile_id, source_url)
);

create table if not exists public.profile_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  mode text not null,
  status text not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.article_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sort_order integer not null default 0,
  published boolean not null default true,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  content jsonb not null default '[]'::jsonb,
  category text,
  cover_image_path text,
  status text not null default 'draft',
  published_at timestamptz,
  sort_order integer not null default 0,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  category_id uuid references public.article_categories(id) on delete set null,
  is_featured boolean not null default false,
  featured_order integer not null default 0,
  cover_image_alt text
);

create table if not exists public.article_images (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists regions_updated_at on public.regions;
create trigger regions_updated_at before update on public.regions for each row execute function public.set_updated_at();
drop trigger if exists cities_updated_at on public.cities;
create trigger cities_updated_at before update on public.cities for each row execute function public.set_updated_at();
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists categories_updated_at on public.article_categories;
create trigger categories_updated_at before update on public.article_categories for each row execute function public.set_updated_at();
drop trigger if exists articles_updated_at on public.articles;
create trigger articles_updated_at before update on public.articles for each row execute function public.set_updated_at();
drop trigger if exists settings_updated_at on public.site_settings;
create trigger settings_updated_at before update on public.site_settings for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 52428800, array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

alter table public.regions disable row level security;
alter table public.cities disable row level security;
alter table public.profiles disable row level security;
alter table public.profile_images disable row level security;
alter table public.profile_cities disable row level security;
alter table public.profile_source_images disable row level security;
alter table public.profile_sync_runs disable row level security;
alter table public.article_categories disable row level security;
alter table public.articles disable row level security;
alter table public.article_images disable row level security;
alter table public.site_settings disable row level security;

select 'schema-ready' as result;
