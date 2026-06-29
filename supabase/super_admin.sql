-- GD Analyzer — super-admins (full control over ALL projects, current + future)
-- Run ONCE in the Supabase SQL Editor. Idempotent.
--
-- A super-admin acts as 'admin' on every project: can view, edit, manage access, delete.
-- Add/remove super-admins by editing the super_admins table.

-- 1) Allowlist table (hidden: RLS on, no policies → only readable via the security-definer
--    function below; never exposed to the client directly).
create table if not exists public.super_admins (
  email text primary key
);
alter table public.super_admins enable row level security;

insert into public.super_admins (email) values ('louis.demoffarts@helexia.eu')
on conflict (email) do nothing;

-- 2) Am I a super-admin? (security definer → bypasses RLS to read the allowlist)
create or replace function public.is_super_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.super_admins
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- 3) Fold super-admin into role resolution: 'owner' if creator, else 'admin' if super-admin,
--    else the explicit share role. is_admin_of()/can_edit() build on this, so update/delete/
--    manage-access policies all grant super-admins automatically.
create or replace function public.my_role_on(pid text)
returns text language sql security definer set search_path = public as $$
  select case
    when exists (select 1 from public.projects p where p.id = pid and p.created_by = auth.uid())
      then 'owner'
    when public.is_super_admin() then 'admin'
    else (select s.role from public.project_shares s
          where s.project_id = pid and lower(s.email) = lower(auth.jwt() ->> 'email')
          limit 1)
  end;
$$;

-- 4) Super-admins can SELECT every project (so the whole portfolio loads).
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (created_by = auth.uid() or public.is_shared_with_me(id) or public.is_super_admin());

grant execute on function public.is_super_admin() to authenticated;
