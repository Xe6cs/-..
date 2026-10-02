-- =============================================================================
-- Safety checks — run any time in SQL Editor. Changes nothing.
-- Every line of the result should say OK. Anything saying FAIL needs attention.
-- =============================================================================
with checks (check_name, ok) as (
  values
    ('RLS on admins',        (select relrowsecurity from pg_class where oid = 'public.admins'::regclass)),
    ('RLS on categories',    (select relrowsecurity from pg_class where oid = 'public.categories'::regclass)),
    ('RLS on products',      (select relrowsecurity from pg_class where oid = 'public.products'::regclass)),
    ('RLS on site_settings', (select relrowsecurity from pg_class where oid = 'public.site_settings'::regclass)),
    ('Visitors cannot add or change sections',
       not has_table_privilege('anon', 'public.categories', 'insert, update, delete')),
    ('Visitors cannot add or change products',
       not has_table_privilege('anon', 'public.products', 'insert, update, delete')),
    ('Visitors cannot change site settings',
       not has_table_privilege('anon', 'public.site_settings', 'insert, update, delete')),
    ('Visitors cannot see the admins list',
       not has_table_privilege('anon', 'public.admins', 'select')),
    ('Image bucket exists and is public',
       coalesce((select public from storage.buckets where id = 'site-images'), false)),
    ('Image upload limited to admins',
       (select count(*) = 4 from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'Admins can % site images')),
    ('Exactly one settings row',  (select count(*) = 1 from public.site_settings)),
    ('Sections added (8)',        (select count(*) = 8 from public.categories)),
    ('At least one admin',        (select count(*) >= 1 from public.admins))
)
select check_name, case when ok then 'OK' else 'FAIL' end as result
from checks;
