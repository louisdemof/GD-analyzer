-- GD Analyzer — restrict signup to allowed email domains (internal tool).
-- Run ONCE in the Supabase SQL Editor. Existing accounts are unaffected (sign-in
-- doesn't insert); only NEW signups from non-allowed domains are blocked.

create table if not exists public.signup_allowed_domains (
  domain text primary key
);
insert into public.signup_allowed_domains (domain) values ('helexia.eu')
on conflict do nothing;

create or replace function public.enforce_signup_domain()
returns trigger language plpgsql security definer set search_path = public as $$
declare dom text;
begin
  dom := lower(split_part(new.email, '@', 2));
  if not exists (select 1 from public.signup_allowed_domains d where d.domain = dom) then
    raise exception 'Cadastro restrito a e-mails autorizados (@helexia.eu).';
  end if;
  return new;
end $$;

drop trigger if exists enforce_signup_domain_trg on auth.users;
create trigger enforce_signup_domain_trg
  before insert on auth.users
  for each row execute function public.enforce_signup_domain();

-- To allow another domain later:
--   insert into public.signup_allowed_domains (domain) values ('outrodominio.com');
