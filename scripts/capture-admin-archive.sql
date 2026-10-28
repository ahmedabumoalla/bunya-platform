-- Run once as the database operator after migration101, before copying files.
-- Does not activate either account. Original RLS is evaluated before the freeze.
begin isolation level repeatable read;
set local statement_timeout='120s';
set local lock_timeout='10s';
select pg_advisory_xact_lock(101);
do $$begin
  if exists(select 1 from private.admin_archive_state where active or captured_at is not null) then raise exception 'Archive already captured; refusing to replace history';end if;
  if not exists(select 1 from public.profiles where id='7f4152b6-63d2-49ec-866f-681a3308f670')
    or not exists(select 1 from public.profiles where id='d5b7d59e-3a22-4d59-8096-d546c9bd8c4e') then raise exception 'Designated archive accounts are missing';end if;
end $$;
create temporary table archive_capture_manifest(table_name text primary key,key_expression text not null,excluded boolean not null) on commit drop;
create temporary table archive_capture_visibility(actor_id uuid,table_name text,row_key jsonb,primary key(actor_id,table_name,row_key)) on commit drop;
create temporary table archive_capture_rpc(actor_id uuid,function_name text,arguments jsonb default '{}'::jsonb,result jsonb,primary key(actor_id,function_name,arguments)) on commit drop;
grant select on archive_capture_manifest to authenticated;
grant insert,select on archive_capture_visibility,archive_capture_rpc to authenticated;

do $$declare t record; column_record record; pk record; projection text; key_expression text; excluded boolean; expression text;begin
  for t in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') and not c.relispartition order by c.relname loop
    projection:='';
    excluded:=t.relname in('onboarding_password_fingerprints','managed_quote_delivery_codes','join_application_revision_tokens','provider_upload_batches','admin_impersonation_sessions','pending_quote_drafts','phone_verification_challenges','push_subscriptions');
    for column_record in select a.attname,format_type(a.atttypid,a.atttypmod) as typ,a.atttypid from pg_attribute a where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped order by a.attnum loop
      expression:=format('%I',column_record.attname);
      if column_record.attname ~* '(^|_)(token|secret|credential|ciphertext|private_key|code_salt|code_hash|encrypted_password|password_fingerprint|binding_hash)(_|$)' or column_record.attname='iban_encrypted' then
        expression:=format('null::%s',column_record.typ);
      elsif column_record.atttypid='jsonb'::regtype then
        if t.relname in('outbox_events','notification_provider_submissions') then expression:='''{}''::jsonb';
        else expression:=format('private.admin_archive_sanitize(%I)',column_record.attname);end if;
      elsif column_record.atttypid='json'::regtype then expression:=format('private.admin_archive_sanitize(%I::jsonb)::json',column_record.attname);
      end if;
      projection:=projection||case when projection='' then '' else ',' end||expression||format(' as %I',column_record.attname);
    end loop;
    select con.conname,pg_get_constraintdef(con.oid) as definition,
      'jsonb_build_object('||string_agg(format('%L,%I',a.attname,a.attname),',' order by k.ordinality)||')' as key_expression
    into pk from pg_constraint con cross join lateral unnest(con.conkey) with ordinality k(attnum,ordinality)
      join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.attnum
    where con.conrelid=t.oid and con.contype='p' group by con.oid,con.conname;
    if not found then raise exception 'Snapshot table % lacks a primary key',t.relname;end if;
    key_expression:=pk.key_expression;
    execute format('create table admin_archive.%I as select %s from public.%I with no data',t.relname,projection,t.relname);
    if not excluded then execute format('insert into admin_archive.%I select %s from public.%I',t.relname,projection,t.relname);end if;
    execute format('alter table admin_archive.%I add constraint %I %s',t.relname,pk.conname,pk.definition);
    -- Embedded relationships may reference unique keys other than the PK.
    for column_record in select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid=t.oid and contype='u' loop
      execute format('alter table admin_archive.%I add constraint %I %s',t.relname,column_record.conname,column_record.definition);
    end loop;
    execute format('alter table admin_archive.%I enable row level security',t.relname);
    execute format('create policy archived_rows_read on admin_archive.%I for select to authenticated using(private.admin_archive_visible(%L,%s))',t.relname,t.relname,key_expression);
    execute format('revoke all on admin_archive.%I from public,anon,authenticated,service_role',t.relname);
    execute format('grant select on admin_archive.%I to authenticated,service_role',t.relname);
    insert into archive_capture_manifest values(t.relname,key_expression,excluded);
  end loop;
end $$;

-- Metadata-only FK reconstruction: never point an archive join back to live data.
do $$declare fk record; source_columns text; target_columns text;begin
  for fk in select con.*,s.relname as source_table,t.relname as target_table from pg_constraint con
    join pg_class s on s.oid=con.conrelid join pg_namespace sn on sn.oid=s.relnamespace
    join pg_class t on t.oid=con.confrelid join pg_namespace tn on tn.oid=t.relnamespace
    where con.contype='f' and sn.nspname='public' and tn.nspname='public' loop
    select string_agg(quote_ident(a.attname),',' order by k.ordinality) into source_columns from unnest(fk.conkey) with ordinality k(attnum,ordinality) join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.attnum;
    select string_agg(quote_ident(a.attname),',' order by k.ordinality) into target_columns from unnest(fk.confkey) with ordinality k(attnum,ordinality) join pg_attribute a on a.attrelid=fk.confrelid and a.attnum=k.attnum;
    execute format('alter table admin_archive.%I add constraint %I foreign key(%s) references admin_archive.%I(%s) not valid',fk.source_table,fk.conname,source_columns,fk.target_table,target_columns);
  end loop;
end $$;

insert into admin_archive.safe_auth_users(id,email,email_confirmed_at,phone_confirmed_at,last_sign_in_at,created_at,updated_at,phone,aud,role)
select id,email,email_confirmed_at,phone_confirmed_at,last_sign_in_at,created_at,updated_at,phone,aud,role from auth.users;
insert into admin_archive.archive_storage_objects(id,bucket_id,name,metadata,updated_at)
select id,bucket_id,name,private.admin_archive_sanitize(metadata),updated_at from storage.objects where bucket_id<>'admin-archive';

-- This is deliberately an invoker DO block, not SECURITY DEFINER: SET ROLE
-- evaluates the real existing policies and catches every permissive/ restrictive
-- combination. Temporary tables are visible only to this transaction/session.
do $$declare actor uuid; t record; conversation record; permissions jsonb;begin
  foreach actor in array array['7f4152b6-63d2-49ec-866f-681a3308f670'::uuid,'d5b7d59e-3a22-4d59-8096-d546c9bd8c4e'::uuid] loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    for t in select * from pg_temp.archive_capture_manifest where not excluded loop
      if has_table_privilege('public.'||quote_ident(t.table_name),'SELECT') then
        execute format('insert into pg_temp.archive_capture_visibility select %L::uuid,%L,%s from public.%I',actor,t.table_name,t.key_expression,t.table_name);
      end if;
    end loop;
    if has_table_privilege('storage.objects','SELECT') then
      insert into pg_temp.archive_capture_visibility select actor,'storage.objects',jsonb_build_object('id',id) from storage.objects where bucket_id<>'admin-archive';
    end if;
    select coalesce(jsonb_object_agg(permission_key,public.admin_has_permission(permission_key)),'{}'::jsonb) into permissions from public.admin_permissions;
    insert into pg_temp.archive_capture_rpc values(actor,'admin_permissions','{}',permissions);
    insert into pg_temp.archive_capture_rpc values(actor,'admin_can_view_administrators','{}',to_jsonb(public.admin_can_view_administrators()));
    insert into pg_temp.archive_capture_rpc values(actor,'is_admin','{}',to_jsonb(public.is_admin()));
    insert into pg_temp.archive_capture_rpc values(actor,'admin_attention_counts','{}',public.admin_attention_counts());
    insert into pg_temp.archive_capture_rpc select actor,'admin_provider_financial_summary','{}',coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) from public.admin_provider_financial_summary() f;
    insert into pg_temp.archive_capture_rpc select actor,'contractor_directory_cards','{}',coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) from public.contractor_directory_cards() f;
    for conversation in select id from public.contractor_conversations loop
      insert into pg_temp.archive_capture_rpc values(actor,'contractor_chat_summary',jsonb_build_object('p_id',conversation.id),public.contractor_chat_summary(conversation.id));
    end loop;
    execute 'reset role';
  end loop;
end $$;
select set_config('request.jwt.claims','{}',true);
insert into private.admin_archive_visibility select * from archive_capture_visibility;
insert into private.admin_archive_rpc_results select actor_id,function_name,arguments,private.admin_archive_sanitize(result) from archive_capture_rpc;

-- Preserve the three existing invoker aliases against archived base tables.
do $$declare x record;begin
  for x in select * from(values('customer_project_requests','project_requests'),('customer_project_request_specialties','project_request_specialties'),('project_proposals','contractor_proposals'),('project_proposal_stages','contractor_proposal_stages')) v(alias_name,table_name) loop
    if to_regclass('public.'||x.alias_name) is not null and to_regclass('admin_archive.'||x.table_name) is not null then
      execute format('create view admin_archive.%I with(security_invoker=true) as select * from admin_archive.%I',x.alias_name,x.table_name);
      execute format('grant select on admin_archive.%I to authenticated,service_role',x.alias_name);
    end if;
  end loop;
end $$;
update private.admin_archive_state set captured_at=transaction_timestamp(),capture_complete=true;
notify pgrst,'reload schema';
select captured_at,capture_complete,files_ready,active from private.admin_archive_state;
commit;
