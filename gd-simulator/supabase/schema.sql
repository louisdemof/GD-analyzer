-- GD Analyzer — Supabase schema (MVP: private-by-default + per-project sharing)
-- Run this in the Supabase SQL Editor after creating the project.
--
-- Model: each project is PRIVATE to its owner. The owner can share a project with
-- specific people by email (project_shares). A user sees a project if they own it
-- OR it has been shared with their email. Open signup is safe because there is no
-- public/shared pool — a new account starts empty. Keep "Confirm email" ON so a
-- share-by-email cannot be hijacked by registering someone else's address.

-- ── Projects ───────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id          text primary key,                 -- the app's own project id
  data        jsonb not null,                    -- the full serialised Project
  created_by  uuid  references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Folders (private to owner) ───────────────────────────────────────────────
create table if not exists public.folders (
  id          text primary key,
  data        jsonb not null,
  created_by  uuid  references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Per-project sharing (by email) ───────────────────────────────────────────
create table if not exists public.project_shares (
  project_id  text not null references public.projects(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now(),
  primary key (project_id, email)
);
create index if not exists project_shares_email_idx on public.project_shares (lower(email));

-- ── updated_at auto-touch ────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists folders_touch on public.folders;
create trigger folders_touch before update on public.folders
  for each row execute function public.touch_updated_at();

-- Helper: is the current user a recipient of a share for this project?
create or replace function public.is_shared_with_me(pid text)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.project_shares s
    where s.project_id = pid
      and lower(s.email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- ── Row-Level Security ───────────────────────────────────────────────────────
alter table public.projects       enable row level security;
alter table public.folders        enable row level security;
alter table public.project_shares enable row level security;

-- Projects: owner has full control; shared recipients can read + edit (not delete).
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (created_by = auth.uid() or public.is_shared_with_me(id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (created_by = auth.uid() or public.is_shared_with_me(id))
  with check (created_by = auth.uid() or public.is_shared_with_me(id));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using (created_by = auth.uid());

-- Folders: strictly private to their owner.
drop policy if exists folders_rw on public.folders;
create policy folders_rw on public.folders
  for all to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Shares: only the project owner can manage them; a recipient may see shares
-- addressed to their own email (so the app can show "shared with me").
drop policy if exists shares_owner_all on public.project_shares;
create policy shares_owner_all on public.project_shares
  for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()));

drop policy if exists shares_recipient_select on public.project_shares;
create policy shares_recipient_select on public.project_shares
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- ── Explicit Data API grants (because "expose new tables" is OFF) ─────────────
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.projects       to authenticated;
grant select, insert, update, delete on public.folders        to authenticated;
grant select, insert, update, delete on public.project_shares to authenticated;
