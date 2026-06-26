-- profiles: a public mirror of auth.users so the Share dialog can autocomplete
-- colleagues by name/email. Run once in the Supabase SQL Editor.
-- Any signed-in user can read the directory (internal team tool) — adjust the
-- SELECT policy if you ever need to restrict who can be discovered.

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text
);

-- Backfill existing users
insert into public.profiles (id, email)
  select id, email from auth.users
  on conflict (id) do nothing;

-- Keep it in sync as new users sign up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: authenticated users can search the directory
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
