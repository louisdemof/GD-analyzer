-- GD Analyzer — "last seen" heartbeat so the admin panel shows real activity, not just
-- the last credential login (auth.users.last_sign_in_at doesn't update on persisted sessions).
-- Run ONCE in the Supabase SQL Editor. Idempotent.

alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Called by the app on load (with a session) to stamp activity.
create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;
grant execute on function public.touch_last_seen() to authenticated;

-- admin_user_stats now reports the most recent of (last login, last seen).
create or replace function public.admin_user_stats()
returns table (id uuid, email text, full_name text, last_sign_in_at timestamptz, project_count bigint)
language sql security definer set search_path = public as $$
  select p.id, p.email, p.full_name,
         greatest(u.last_sign_in_at, p.last_seen_at) as last_sign_in_at,
         (select count(*) from public.projects pr where pr.created_by = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_super_admin()
  order by greatest(u.last_sign_in_at, p.last_seen_at) desc nulls last;
$$;
grant execute on function public.admin_user_stats() to authenticated;
