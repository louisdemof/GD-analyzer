-- GD Analyzer — audit trail (who did what, when) on projects.
-- Run ONCE in the Supabase SQL Editor. Append-only.

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  project_id  text not null,
  actor_email text not null,
  action      text not null,        -- create | trash | restore | delete | share | role_change | unshare
  detail      text,                 -- human-readable extra ("lucas@… como admin")
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_project_idx on public.audit_log (project_id, created_at desc);

alter table public.audit_log enable row level security;

-- Insert: you can only log as yourself.
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (lower(actor_email) = lower(auth.jwt() ->> 'email'));

-- Read: anyone who has any role on the project (owner/admin/editor/viewer/super-admin).
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log
  for select to authenticated
  using (public.my_role_on(project_id) is not null);

-- Append-only: no update/delete grants.
grant select, insert on public.audit_log to authenticated;
