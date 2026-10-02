-- =============================================================================
-- Makes an existing Supabase user an admin of the site.
-- 1. Create the user first: Authentication → Users → Add user.
-- 2. In the line starting with "select", replace the placeholder text between
--    the quotes with that user's email (keep the quotes).
-- 3. Run. One row in the result = success. No rows = the email was not found.
-- Do not save your real email back into this file.
-- =============================================================================
insert into public.admins (user_id)
select id from auth.users where lower(email) = lower('PUT-ADMIN-EMAIL-HERE')
on conflict (user_id) do nothing
returning user_id;
