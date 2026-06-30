-- admin_user_stats: also expose banned_until (deactivated users). Idempotent.
drop function if exists public.admin_user_stats();
create function public.admin_user_stats()
returns table (id uuid, email text, full_name text, last_sign_in_at timestamptz, project_count bigint, banned_until timestamptz)
language sql security definer set search_path = public as $$
  select p.id, p.email, p.full_name,
         greatest(u.last_sign_in_at, p.last_seen_at) as last_sign_in_at,
         (select count(*) from public.projects pr where pr.created_by = p.id),
         u.banned_until
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_super_admin()
  order by greatest(u.last_sign_in_at, p.last_seen_at) desc nulls last;
$$;
grant execute on function public.admin_user_stats() to authenticated;
