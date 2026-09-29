begin;

-- Existing requests were explicitly named; new blank names follow the English company name.
alter table public.provider_applications add column username_is_custom boolean not null default true;

create or replace function public.resolve_provider_application_username()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if nullif(btrim(new.requested_username),'') is null then
    new.requested_username:=btrim(regexp_replace(new.company_name_en,'\s+',' ','g'));
    new.username_is_custom:=false;
  else
    new.requested_username:=btrim(regexp_replace(new.requested_username,'\s+',' ','g'));
    new.username_is_custom:=true;
  end if;
  if new.requested_username is null or char_length(new.requested_username) not between 2 and 160 or new.requested_username ~ '[[:cntrl:]]' then
    raise exception 'Invalid provider username' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.resolve_provider_application_username() from public,anon,authenticated;
create trigger provider_application_resolve_username before insert or update of requested_username,company_name_en on public.provider_applications
  for each row execute function public.resolve_provider_application_username();

-- Preserve other account rules while allowing the full English company name for providers.
alter table public.profiles drop constraint profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (
  username is null or (
    ((coalesce(role='provider',false) and char_length(username) between 2 and 160) or char_length(username) between 4 and 40)
    and username=btrim(username) and username !~ '[[:cntrl:]]'
  )
);
alter table public.provider_profiles drop constraint provider_profiles_username_format;
alter table public.provider_profiles add constraint provider_profiles_username_format check (
  username is null or (char_length(username) between 2 and 160 and username=btrim(username) and username !~ '[[:cntrl:]]')
);

commit;
