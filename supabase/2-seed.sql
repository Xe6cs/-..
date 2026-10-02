-- =============================================================================
-- باينباغ — FILE 2 of 4: the site's current sections and texts
-- Run SECOND, after 1-schema.sql: SQL Editor → New query → paste → Run.
-- Adds the 8 sections to public.categories. The settings row with the home-page
-- texts was already created by file 1 (public.site_settings).
-- Products and images are NOT added here; they move over in a later stage.
-- Safe to run again: sections that already exist are skipped.
-- =============================================================================

-- Stop with a clear message if file 1 has not been run yet.
do $$
begin
  if to_regclass('public.categories') is null then
    raise exception 'الجداول غير موجودة بعد. شغّل الملف 1-schema.sql أولاً (Run 1-schema.sql first)';
  end if;
end
$$;

-- The two groups
insert into public.categories (slug, name, subtitle, show_on_home, sort_order)
values
  ('ties',           'ربطات العنق', null, false, 0),
  ('other-products', 'منتجات اخرى', null, true,  4)
on conflict (slug) do nothing;

-- Tie sizes (shown on the home page, and as tabs on each tie page)
insert into public.categories (parent_id, slug, name, subtitle, show_on_home, sort_order)
select g.id, v.slug, v.name, 'ربطة عنق قياس', true, v.sort_order
from public.categories g
cross join (values
  ('ties-7cm', '7 سنتميتر', 1),
  ('ties-9cm', '9 سنتميتر', 2),
  ('ties-5cm', '5 سنتميتر', 3)
) as v (slug, name, sort_order)
where g.slug = 'ties'
on conflict (slug) do nothing;

-- Other products (cards on the "منتجات اخرى" page, and tabs on each page)
insert into public.categories (parent_id, slug, name, subtitle, description, sort_order)
select g.id, v.slug, v.name, 'منتجات اخرى', v.description, v.sort_order
from public.categories g
cross join (values
  ('pajamas', 'بجامة نوم',
   E'سيت بجامة نوم رجالي ستن سيرة\n'
   'سيت اربع قطع روب بيجامة قميص شورت\n'
   'السعر ٥٠ الف للسيت\n'
   'يوجد توصيل لجميع مناطق العراق خمسة الف\n'
   'يتوفر اربع الوان\n'
   'ماروني ونيلي وبيجي ورصاصي\n'
   'قياسات\n'
   'مديم يلبس من وزن 65 الى 80\n'
   'لارج يلبس من وزن 80 الى 95\n'
   'اكس لارج يلبس من وزن 95 ال 105\n'
   'دبل اكس يلبس من وزن 105 الى 125', 1),
  ('bow-ties',   'بابيون',      null, 2),
  ('suspenders', 'شيال بنطرون', null, 3)
) as v (slug, name, description, sort_order)
where g.slug = 'other-products'
on conflict (slug) do nothing;
