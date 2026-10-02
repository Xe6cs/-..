-- =============================================================================
-- باينباغ — starting data: the site's current sections and texts
-- Run once, after the schema (migrations/20261002000000_initial_schema.sql).
-- Products and images are NOT added here; they move over in a later stage.
-- =============================================================================

-- The two groups
insert into public.categories (slug, name, subtitle, show_on_home, sort_order)
values
  ('ties',           'ربطات العنق', null, false, 0),
  ('other-products', 'منتجات اخرى', null, true,  4);

-- Tie sizes (shown on the home page, and as tabs on each tie page)
insert into public.categories (parent_id, slug, name, subtitle, show_on_home, sort_order)
select g.id, v.slug, v.name, 'ربطة عنق قياس', true, v.sort_order
from public.categories g
cross join (values
  ('ties-7cm', '7 سنتميتر', 1),
  ('ties-9cm', '9 سنتميتر', 2),
  ('ties-5cm', '5 سنتميتر', 3)
) as v (slug, name, sort_order)
where g.slug = 'ties';

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
where g.slug = 'other-products';
