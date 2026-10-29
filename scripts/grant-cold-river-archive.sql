-- Explicit owner-requested exception, 2026-10-30: expose this contractor's
-- account snapshot to the two frozen operators. No live access, recapture,
-- document copies, operational transactions, or changes to other identities.
-- Run with supabase db query --linked --file after a rollback rehearsal.
begin isolation level repeatable read;
set local lock_timeout='10s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(101);
do $$
declare
  subject constant uuid := '10fc486b-247e-44be-a292-148341eadd2a';
  contractor constant uuid := 'e334c815-6965-4709-9d52-0679cabc4b7a';
  application constant uuid := '12184dd8-3919-4129-bb1e-7c9820380c54';
  owner_id constant uuid := '8b9f3886-e1b8-4816-9fbb-d425b0753255';
  actors constant uuid[] := array['7f4152b6-63d2-49ec-866f-681a3308f670','d5b7d59e-3a22-4d59-8096-d546c9bd8c4e']::uuid[];
  t record; col record; projection text; columns text; expression text; key_expression text;
  rows_added integer; visibility_added integer; totals jsonb := '{}'::jsonb; actor uuid;
begin
  if not exists(select 1 from private.admin_archive_state where active and capture_complete and files_ready and api_ready
      and captured_at='2026-10-28T11:21:28.966975Z'::timestamptz) then raise exception 'Expected active original archive missing'; end if;
  if not exists(select 1 from public.profiles where id=subject and full_name='النهر البارد لأعمال التكييف' and role='contractor')
    or not exists(select 1 from public.contractor_profiles where id=contractor and profile_id=subject and application_id=application)
    or not exists(select 1 from public.contractor_applications where id=application and applicant_profile_id=subject)
    or exists(select 1 from public.user_roles where profile_id=subject and role='admin' and revoked_at is null)
    then raise exception 'Subject identity mismatch'; end if;
  foreach actor in array actors loop
    if not private.admin_archive_frozen(actor) or not private.admin_archive_eligible(actor) then raise exception 'Expected frozen operator unavailable'; end if;
  end loop;
  if exists(select 1 from public.audit_logs where entity_table='profiles' and entity_id=subject::text and action='admin_archive_subject_added') then
    raise notice 'This explicit snapshot exception was already applied; no refresh performed'; return;
  end if;
  -- Explicit dependency order; all filters are fixed UUIDs, never user SQL.
  for t in select * from (values
    ('profiles',format('id=%L::uuid',subject),1),
    ('user_roles',format('profile_id=%L::uuid and role<>%L',subject,'admin'),2),
    ('contractor_applications',format('id=%L::uuid',application),3),
    ('contractor_profiles',format('id=%L::uuid',contractor),4),
    ('contractor_profile_specialties',format('profile_id=%L::uuid',contractor),5),
    ('contractor_profile_regions',format('profile_id=%L::uuid',contractor),6),
    ('contractor_specialties',format('application_id=%L::uuid',application),7),
    ('contractor_work_regions',format('application_id=%L::uuid',application),8)
  ) selected(table_name,predicate,sequence) order by sequence loop
    projection:=''; columns:='';
    for col in select a.attname,format_type(a.atttypid,a.atttypmod) as typ,a.atttypid
      from pg_attribute a where a.attrelid=to_regclass('admin_archive.'||t.table_name) and a.attnum>0 and not a.attisdropped order by a.attnum loop
      expression:=format('%I',col.attname);
      if col.attname ~* '(^|_)(token|secret|credential|ciphertext|private_key|code_salt|code_hash|encrypted_password|password_fingerprint|binding_hash)(_|$)' or col.attname='iban_encrypted' then
        expression:=format('null::%s',col.typ);
      elsif col.atttypid='jsonb'::regtype then expression:=format('private.admin_archive_sanitize(%I)',col.attname);
      elsif col.atttypid='json'::regtype then expression:=format('private.admin_archive_sanitize(%I::jsonb)::json',col.attname);end if;
      projection:=projection||case when projection='' then '' else ',' end||expression;
      columns:=columns||case when columns='' then '' else ',' end||format('%I',col.attname);
    end loop;
    execute format('insert into admin_archive.%I(%s) select %s from public.%I where %s on conflict do nothing',t.table_name,columns,projection,t.table_name,t.predicate);
    get diagnostics rows_added=row_count;
    select 'jsonb_build_object('||string_agg(format('%L,%I',a.attname,a.attname),',' order by k.ordinality)||')'
      into key_expression from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(attnum,ordinality)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
      where c.conrelid=to_regclass('admin_archive.'||t.table_name) and c.contype='p';
    if key_expression is null then raise exception 'Missing primary key';end if;
    visibility_added:=0;
    foreach actor in array actors loop
      execute format('insert into private.admin_archive_visibility(actor_id,table_name,row_key) select %L::uuid,%L,%s from admin_archive.%I where %s on conflict do nothing',actor,t.table_name,key_expression,t.table_name,t.predicate);
      get diagnostics rows_added=row_count;
      visibility_added:=visibility_added+rows_added;
    end loop;
    totals:=totals||jsonb_build_object(t.table_name,visibility_added);
  end loop;
  insert into admin_archive.safe_auth_users(id,email,email_confirmed_at,phone_confirmed_at,last_sign_in_at,created_at,updated_at,phone,aud,role)
    select id,email,email_confirmed_at,phone_confirmed_at,last_sign_in_at,created_at,updated_at,phone,aud,role from auth.users where id=subject on conflict do nothing;
  insert into public.audit_logs(actor_profile_id,entity_table,entity_id,action,new_data)
  values(owner_id,'profiles',subject::text,'admin_archive_subject_added',jsonb_build_object(
    'reason','Explicit owner request to expose this account to both frozen operators',
    'executor_role',current_user,'actor_ids',actors,'snapshot_at',statement_timestamp(),
    'original_cutoff','2026-10-28T11:21:28.966975Z','visibility_rows_added',totals));
end $$;
commit;
