-- GD Analyzer — display names in profiles (so colleagues show as names, not emails).
-- Run ONCE in the Supabase SQL Editor. Idempotent.

alter table public.profiles add column if not exists full_name text;

-- Keep profiles in sync with auth metadata on signup AND profile updates.
create or replace function public.sync_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(nullif(excluded.full_name,''), public.profiles.full_name);
  return new;
end $$;

drop trigger if exists on_auth_user_synced on auth.users;
create trigger on_auth_user_synced
  after insert or update on auth.users
  for each row execute function public.sync_profile();

-- Let a user create/update their own profile row (My Account name editor fallback).
alter table public.profiles enable row level security;
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Backfill names already present in auth metadata.
update public.profiles p
set full_name = nullif(u.raw_user_meta_data->>'full_name','')
from auth.users u
where u.id = p.id
  and coalesce(p.full_name,'') = ''
  and nullif(u.raw_user_meta_data->>'full_name','') is not null;
