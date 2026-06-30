-- Expose the super-admin allowlist to super-admins only (for the admin panel badge).
-- Run ONCE in the SQL Editor (idempotent).
create or replace function public.super_admin_emails()
returns setof text language sql security definer set search_path = public as $$
  select email from public.super_admins where public.is_super_admin();
$$;
grant execute on function public.super_admin_emails() to authenticated;
