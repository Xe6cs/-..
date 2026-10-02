-- =============================================================================
-- باينباغ — initial database schema
-- Run once in Supabase: SQL Editor → New query → paste this whole file → Run.
--
-- Security model
--   * Visitors (role "anon") can only READ visible sections, products and the
--     site settings.
--   * Only signed-in users listed in public.admins can add, edit or delete.
--   * Public sign-up is switched off in the dashboard, and even if it were
--     ever switched on, a new account is not an admin until it is added to
--     public.admins by hand.
-- =============================================================================

-- Helpers live in a private schema that the public API does not expose.
create schema if not exists private;

-- -----------------------------------------------------------------------------
-- Admins: the only accounts allowed to change site content
-- -----------------------------------------------------------------------------
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Keeps updated_at current on every edit.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sections (categories)
--   A section can sit inside another one (parent_id): the tie sizes belong to
--   "ربطات العنق", and بابيون / بجامة نوم / شيال بنطرون belong to "منتجات اخرى".
--   Sections with the same parent appear together as tabs.
-- -----------------------------------------------------------------------------
create table public.categories (
  id              uuid primary key default gen_random_uuid(),
  parent_id       uuid references public.categories (id) on delete restrict,
  slug            text not null unique
                  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name            text not null check (char_length(name) between 1 and 60),
  subtitle        text check (char_length(subtitle) <= 60),
  description     text check (char_length(description) <= 2000),
  card_image_path text,
  show_on_home    boolean not null default false,
  sort_order      integer not null default 0,
  is_visible      boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create index categories_parent_sort_idx on public.categories (parent_id, sort_order);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Products: photos only (matching the current design), each in one section
-- -----------------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete restrict,
  image_path  text not null,
  alt_text    text check (char_length(alt_text) <= 200),
  sort_order  integer not null default 0,
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index products_category_sort_idx on public.products (category_id, sort_order);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Site settings: exactly one row
-- -----------------------------------------------------------------------------
create table public.site_settings (
  id              boolean primary key default true check (id),
  whatsapp_number text check (whatsapp_number ~ '^[0-9]{8,15}$'),
  hero_title      text not null default 'المتجر الاول في العراق',
  hero_line_1     text not null default 'المختص بربطات العنق والاكسسوارات',
  hero_line_2     text not null default 'الملابس الرسمية',
  map_image_path  text,
  map_url         text check (map_url ~ '^https://'),
  updated_at      timestamptz not null default now()
);

create trigger site_settings_set_updated_at
  before update on public.site_settings
  for each row execute function private.set_updated_at();

insert into public.site_settings (id) values (true);

-- -----------------------------------------------------------------------------
-- Table permissions: visitors read; signed-in users may attempt changes,
-- and Row Level Security below lets only admins actually make them.
-- -----------------------------------------------------------------------------
revoke all on public.admins, public.categories, public.products, public.site_settings
  from anon, authenticated;

grant select on public.categories, public.products, public.site_settings to anon, authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant update on public.site_settings to authenticated;
grant select on public.admins to authenticated;

alter table public.admins        enable row level security;
alter table public.categories    enable row level security;
alter table public.products      enable row level security;
alter table public.site_settings enable row level security;

-- Admins table: a signed-in user can only see whether they themselves are an admin.
create policy "Users can see their own admin row"
  on public.admins for select to authenticated
  using (user_id = (select auth.uid()));

-- Sections
create policy "Visitors can read visible sections"
  on public.categories for select to anon
  using (is_visible);

create policy "Signed-in users read visible sections, admins read all"
  on public.categories for select to authenticated
  using (is_visible or (select private.is_admin()));

create policy "Admins can add sections"
  on public.categories for insert to authenticated
  with check ((select private.is_admin()));

create policy "Admins can edit sections"
  on public.categories for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "Admins can delete sections"
  on public.categories for delete to authenticated
  using ((select private.is_admin()));

-- Products
create policy "Visitors can read visible products"
  on public.products for select to anon
  using (is_visible);

create policy "Signed-in users read visible products, admins read all"
  on public.products for select to authenticated
  using (is_visible or (select private.is_admin()));

create policy "Admins can add products"
  on public.products for insert to authenticated
  with check ((select private.is_admin()));

create policy "Admins can edit products"
  on public.products for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "Admins can delete products"
  on public.products for delete to authenticated
  using ((select private.is_admin()));

-- Site settings
create policy "Everyone can read site settings"
  on public.site_settings for select to anon, authenticated
  using (true);

create policy "Admins can edit site settings"
  on public.site_settings for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- Storage: one public bucket for site images
--   Public = anyone can VIEW an image by its link (needed to show products).
--   Uploading, replacing and deleting are limited to admins.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-images', 'site-images', true, 5242880,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "Admins can list site images"
  on storage.objects for select to authenticated
  using (bucket_id = 'site-images' and (select private.is_admin()));

create policy "Admins can upload site images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'site-images' and (select private.is_admin()));

create policy "Admins can replace site images"
  on storage.objects for update to authenticated
  using (bucket_id = 'site-images' and (select private.is_admin()))
  with check (bucket_id = 'site-images' and (select private.is_admin()));

create policy "Admins can delete site images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'site-images' and (select private.is_admin()));
