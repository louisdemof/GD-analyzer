-- GD Analyzer — admin user stats (name, email, last login, project count).
-- Super-admins only (returns no rows otherwise). Run ONCE in the Supabase SQL Editor.

create or replace function public.admin_user_stats()
returns table (id uuid, email text, full_name text, last_sign_in_at timestamptz, project_count bigint)
language sql security definer set search_path = public as $$
  select p.id, p.email, p.full_name, u.last_sign_in_at,
         (select count(*) from public.projects pr where pr.created_by = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_super_admin()        -- non-super-admins get zero rows
  order by u.last_sign_in_at desc nulls last;
$$;

grant execute on function public.admin_user_stats() to authenticated;
