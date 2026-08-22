-- Supabase Auth normalizes phone values without a leading plus. Public tables
-- keep the platform's canonical E.164 representation for uniqueness/lookups.
create or replace function public.sync_verified_auth_phone()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_mobile text;
begin
  if new.phone is not null and new.phone_confirmed_at is not null then
    v_mobile := '+' || regexp_replace(new.phone, '[^0-9]', '', 'g');
    if v_mobile !~ '^\+9665[0-9]{8}$' then
      raise exception 'Verified phone must be a Saudi mobile number';
    end if;
    new.raw_user_meta_data := jsonb_set(
      coalesce(new.raw_user_meta_data, '{}'::jsonb),
      '{mobile}',
      to_jsonb(v_mobile),
      true
    );
    update public.profiles set mobile = v_mobile, updated_at = now() where id = new.id;
    update public.providers set mobile = v_mobile, updated_at = now() where owner_profile_id = new.id;
  elsif new.phone is null then
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'mobile';
    update public.profiles set mobile = null, updated_at = now() where id = new.id;
    update public.providers set mobile = null, updated_at = now() where owner_profile_id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_verified_auth_phone() from public, anon, authenticated;
