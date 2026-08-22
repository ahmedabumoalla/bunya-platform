create or replace function public.save_customer_address(
  p_id uuid,
  p_label text,
  p_project_name text,
  p_google_maps_url text,
  p_city text,
  p_region text,
  p_description text,
  p_recipient_name text,
  p_recipient_mobile text,
  p_is_default boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_make_default boolean;
begin
  if auth.uid() is null or not exists (
    select 1 from public.customer_profiles where profile_id = auth.uid()
  ) then
    raise exception 'Customer account required';
  end if;

  if btrim(coalesce(p_label, '')) = ''
     or btrim(coalesce(p_project_name, '')) = ''
     or btrim(coalesce(p_google_maps_url, '')) !~ '^https?://'
     or btrim(coalesce(p_city, '')) = ''
     or btrim(coalesce(p_region, '')) = ''
     or btrim(coalesce(p_recipient_name, '')) = ''
     or btrim(coalesce(p_recipient_mobile, '')) = '' then
    raise exception 'Address fields are incomplete';
  end if;

  v_make_default := p_is_default or (
    p_id is null and not exists (
      select 1 from public.customer_addresses where customer_profile_id = auth.uid()
    )
  );

  if v_make_default then
    update public.customer_addresses
       set is_default = false
     where customer_profile_id = auth.uid()
       and is_default;
  end if;

  if p_id is null then
    insert into public.customer_addresses (
      customer_profile_id, label, project_name, google_maps_url, city, region,
      description, recipient_name, recipient_mobile, is_default
    ) values (
      auth.uid(), btrim(p_label), btrim(p_project_name), btrim(p_google_maps_url),
      btrim(p_city), btrim(p_region), nullif(btrim(p_description), ''),
      btrim(p_recipient_name), btrim(p_recipient_mobile), v_make_default
    ) returning id into v_id;
  else
    update public.customer_addresses
       set label = btrim(p_label),
           project_name = btrim(p_project_name),
           google_maps_url = btrim(p_google_maps_url),
           city = btrim(p_city),
           region = btrim(p_region),
           description = nullif(btrim(p_description), ''),
           recipient_name = btrim(p_recipient_name),
           recipient_mobile = btrim(p_recipient_mobile),
           is_default = v_make_default
     where id = p_id and customer_profile_id = auth.uid()
     returning id into v_id;
    if v_id is null then raise exception 'Address not found'; end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.delete_customer_address(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.customer_addresses
   where id = p_id and customer_profile_id = auth.uid();
  if not found then raise exception 'Address not found'; end if;
end;
$$;

revoke execute on function public.save_customer_address(uuid,text,text,text,text,text,text,text,text,boolean) from public, anon;
revoke execute on function public.delete_customer_address(uuid) from public, anon;
grant execute on function public.save_customer_address(uuid,text,text,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.delete_customer_address(uuid) to authenticated;
