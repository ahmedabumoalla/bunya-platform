-- Preserve immutable audit rows while allowing FK referential actions to anonymize deleted parents.
-- Direct UPDATE/DELETE operations remain rejected, including service-role requests.

begin;

alter table public.project_audit_logs
  alter column project_request_id drop not null;

alter table public.project_audit_logs
  drop constraint if exists project_audit_logs_project_request_id_fkey;

alter table public.project_audit_logs
  add constraint project_audit_logs_project_request_id_fkey
  foreign key (project_request_id)
  references public.project_requests (id)
  on delete set null;

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    if tg_table_name = 'audit_logs'
      and (v_old - array['actor_profile_id','provider_id','contractor_profile_id']) = (v_new - array['actor_profile_id','provider_id','contractor_profile_id'])
      and (v_new->'actor_profile_id' = v_old->'actor_profile_id' or v_new->'actor_profile_id' = 'null'::jsonb)
      and (v_new->'provider_id' = v_old->'provider_id' or v_new->'provider_id' = 'null'::jsonb)
      and (v_new->'contractor_profile_id' = v_old->'contractor_profile_id' or v_new->'contractor_profile_id' = 'null'::jsonb)
      and v_new is distinct from v_old
    then
      return new;
    end if;

    if tg_table_name = 'project_audit_logs'
      and (v_old - array['project_request_id','actor_profile_id']) = (v_new - array['project_request_id','actor_profile_id'])
      and (v_new->'project_request_id' = v_old->'project_request_id' or v_new->'project_request_id' = 'null'::jsonb)
      and (v_new->'actor_profile_id' = v_old->'actor_profile_id' or v_new->'actor_profile_id' = 'null'::jsonb)
      and v_new is distinct from v_old
    then
      return new;
    end if;
  end if;

  raise exception 'Audit records are immutable';
end
$$;

commit;
