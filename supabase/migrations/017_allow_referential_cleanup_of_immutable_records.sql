begin;

create or replace function public.prevent_financial_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    if tg_table_name = 'contractor_financial_transactions'
      and (v_old - array['contractor_profile_id','project_id']) = (v_new - array['contractor_profile_id','project_id'])
      and (v_new->'contractor_profile_id' = v_old->'contractor_profile_id' or v_new->'contractor_profile_id' = 'null'::jsonb)
      and (v_new->'project_id' = v_old->'project_id' or v_new->'project_id' = 'null'::jsonb)
      and v_new is distinct from v_old
    then
      return new;
    end if;
  end if;
  raise exception 'Financial history is immutable';
end
$$;

create or replace function public.prevent_settlement_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    if (v_old - array['contractor_profile_id','bank_account_id','reviewed_by']) = (v_new - array['contractor_profile_id','bank_account_id','reviewed_by'])
      and (v_new->'contractor_profile_id' = v_old->'contractor_profile_id' or v_new->'contractor_profile_id' = 'null'::jsonb)
      and (v_new->'bank_account_id' = v_old->'bank_account_id' or v_new->'bank_account_id' = 'null'::jsonb)
      and (v_new->'reviewed_by' = v_old->'reviewed_by' or v_new->'reviewed_by' = 'null'::jsonb)
      and v_new is distinct from v_old
    then
      return new;
    end if;
  end if;
  raise exception 'Financial records are append-only and cannot be deleted';
end
$$;

commit;
