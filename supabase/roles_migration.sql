-- GD Analyzer — roles & co-admins migration
-- Run ONCE in the Supabase SQL Editor (safe/idempotent; preserves existing shares).
--
-- Model: each project has an owner (created_by, implicit admin). Others are shared by
-- email with a ROLE:
--   admin  — co-owner: edit + manage access (add/remove people, change roles)
--   editor — can modify the project (default; matches old behaviour)
--   viewer — read-only
-- Edit  = owner | admin | editor.  Delete & manage-access = owner | admin.  Viewer = read-only.

-- 1) Add the role column (existing rows default to 'editor' → no behaviour change).
alter table public.project_shares
  add column if not exists role text not null default 'editor';
do $$ begin
  alter table public.project_shares
    add constraint project_shares_role_chk check (role in ('admin','editor','viewer'));
exception when duplicate_object then null; end $$;

-- 2) Role helpers (security definer → bypass RLS inside, no recursion).
create or replace function public.my_role_on(pid text)
returns text language sql security definer set search_path = public as $$
  select case
    when exists (select 1 from public.projects p where p.id = pid and p.created_by = auth.uid())
      then 'owner'
    else (select s.role from public.project_shares s
          where s.project_id = pid and lower(s.email) = lower(auth.jwt() ->> 'email')
          limit 1)
  end;
$$;

create or replace function public.is_admin_of(pid text)
returns boolean language sql security definer set search_path = public as $$
  select public.my_role_on(pid) in ('owner','admin');
$$;

create or replace function public.can_edit(pid text)
returns boolean language sql security definer set search_path = public as $$
  select public.my_role_on(pid) in ('owner','admin','editor');
$$;

-- Owner email for "creator" display.
create or replace function public.project_owner_email(pid text)
returns text language sql security definer set search_path = public as $$
  select pr.email from public.projects p
  join public.profiles pr on pr.id = p.created_by
  where p.id = pid;
$$;

-- 3) Tighten project policies to honour roles.
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (public.can_edit(id))
  with check (public.can_edit(id));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using (public.is_admin_of(id));

-- 4) Owner OR co-admins manage shares (was owner-only).
drop policy if exists shares_owner_all on public.project_shares;
drop policy if exists shares_admin_all on public.project_shares;
create policy shares_admin_all on public.project_shares
  for all to authenticated
  using (public.is_admin_of(project_id))
  with check (public.is_admin_of(project_id));
-- (shares_recipient_select stays: a user can still see the row addressed to them.)

grant execute on function public.my_role_on(text), public.is_admin_of(text),
  public.can_edit(text), public.project_owner_email(text) to authenticated;
