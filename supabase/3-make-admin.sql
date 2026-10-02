-- =============================================================================
-- باينباغ — FILE 3 of 4: make your account the site admin
-- Run THIRD, after creating your user in Authentication → Users → Add user.
-- 1. In the line starting with "where", replace the placeholder text between
--    the quotes with that user's email (keep the quotes).
-- 2. Run. The result is one sentence saying whether it worked.
-- Adds a row to public.admins. Do not save your real email back into this file.
-- =============================================================================

-- Stop with a clear message if file 1 has not been run yet.
do $$
begin
  if to_regclass('public.admins') is null then
    raise exception 'الجداول غير موجودة بعد. شغّل الملف 1-schema.sql أولاً (Run 1-schema.sql first)';
  end if;
end
$$;

with target as (
  select id from auth.users
  where lower(email) = lower('PUT-ADMIN-EMAIL-HERE')
), added as (
  insert into public.admins (user_id)
  select id from target
  on conflict (user_id) do nothing
  returning user_id
)
select case
  when exists (select 1 from target)
    then 'تم: هذا الحساب أصبح مدير الموقع (Done: this account is now the admin)'
  else 'لم يُعثر على هذا البريد. تأكد أنه مطابق تماماً للبريد في Authentication → Users (Email not found)'
end as result;
