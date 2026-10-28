-- PostgREST defaults to the first exposed schema; preserve caller order.
create or replace function public.configure_admin_archive_api(p_current_schemas text,p_previous_pre_request text default null)
returns void language plpgsql security definer set search_path='' as $$
declare schemas text; previous oid;
begin
  if nullif(btrim(p_current_schemas),'') is null then raise exception 'Current exposed schemas are required';end if;
  select string_agg(quote_ident(name),', ' order by first_position) into schemas
  from (
    select btrim(value) as name,min(position) as first_position
    from unnest(string_to_array(p_current_schemas,',')||array['admin_archive']) with ordinality supplied(value,position)
    where btrim(value)<>'' group by btrim(value)
  ) ordered_schemas;
  if nullif(btrim(p_previous_pre_request),'') is not null then
    previous:=to_regprocedure(p_previous_pre_request||'()');
    if previous is null or previous='public.guard_admin_archive_request()'::regprocedure then raise exception 'Invalid previous request hook';end if;
  end if;
  execute format('alter role authenticator set pgrst.db_schemas = %L',schemas);
  execute 'alter role authenticator set pgrst.db_pre_request = ''public.guard_admin_archive_request''';
  update private.admin_archive_state set api_ready=true,previous_pre_request=previous where singleton=true;
  notify pgrst,'reload config'; notify pgrst,'reload schema';
end $$;
revoke all on function public.configure_admin_archive_api(text,text) from public,anon,authenticated;
grant execute on function public.configure_admin_archive_api(text,text) to service_role;

-- Correct the observed three-schema installation without touching the hook or
-- archive state. Refuse unknown schema inventories instead of dropping access.
do $$declare configured text; schema_names text[];begin
  select substring(setting from length('pgrst.db_schemas=')+1) into configured
  from pg_roles r cross join lateral unnest(r.rolconfig) setting
  where r.rolname='authenticator' and setting like 'pgrst.db_schemas=%';
  select array_agg(name order by name) into schema_names from (
    select distinct btrim(value) as name from unnest(string_to_array(configured,',')) value
    where btrim(value)<>''
  ) names;
  if schema_names is distinct from array['admin_archive','graphql_public','public']::text[] then
    raise exception 'Unexpected exposed schema inventory; verify configuration before repairing order';
  end if;
  alter role authenticator set pgrst.db_schemas='public, graphql_public, admin_archive';
end $$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
