begin;

-- profiles.mobile is the canonical verified contact channel. Contractor
-- application/contact numbers remain available in contractor_profiles.phone
-- and must not reserve a Supabase Auth phone before possession is proven.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_verified_mobile text;
begin
  if new.phone is not null
     and new.phone_confirmed_at is not null
     and regexp_replace(new.phone, '[^0-9]', '', 'g') ~ '^9665[0-9]{8}$' then
    v_verified_mobile := '+' || regexp_replace(new.phone, '[^0-9]', '', 'g');
  end if;

  insert into public.profiles (id, role, username, full_name, mobile, email)
  values (
    new.id,
    'customer',
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    v_verified_mobile,
    new.email
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

-- Remove legacy/application phone values that were copied into profiles even
-- though the corresponding Auth identity never confirmed the number.
update public.profiles profile
set mobile = null,
    updated_at = now()
from auth.users account
where account.id = profile.id
  and profile.mobile is not null
  and (account.phone is null or account.phone_confirmed_at is null);

commit;
