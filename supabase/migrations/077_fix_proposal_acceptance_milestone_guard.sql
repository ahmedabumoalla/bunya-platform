begin;

-- Proposal acceptance creates the initial milestone rows as the project
-- customer inside decide_contractor_proposal(). Keep direct customer inserts
-- blocked by RLS, while allowing that valid participant-owned initialization.
create or replace function public.protect_contractor_milestone_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_project public.contractor_projects%rowtype;
  v_is_contractor_owner boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     or public.admin_has_permission('projects.manage') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Project milestones cannot be deleted by project participants';
  end if;

  select * into v_project
  from public.contractor_projects
  where id = new.project_id;
  if not found then raise exception 'Project not found'; end if;

  v_is_contractor_owner := coalesce(
    public.is_contractor_owner(v_project.contractor_profile_id),
    false
  );

  if tg_op = 'INSERT' then
    if new.status is distinct from 'not_started'::public.contractor_milestone_status
       or coalesce(new.progress, 0) <> 0
       or new.approved_at is not null
       or (
         not v_is_contractor_owner
         and v_project.customer_profile_id is distinct from auth.uid()
       ) then
      raise exception 'Invalid participant milestone creation';
    end if;
    return new;
  end if;

  if v_project.customer_profile_id = auth.uid() then
    if old.status <> 'awaiting_customer_approval'
       or new.status <> 'approved'
       or (to_jsonb(new) - array['status','approved_at','updated_at'])
          is distinct from (to_jsonb(old) - array['status','approved_at','updated_at']) then
      raise exception 'Customer may only approve an awaiting milestone';
    end if;
  else
    if not v_is_contractor_owner
       or new.project_id is distinct from old.project_id
       or new.name is distinct from old.name
       or new.description is distinct from old.description
       or new.start_at is distinct from old.start_at
       or new.expected_end_at is distinct from old.expected_end_at
       or new.value_percentage is distinct from old.value_percentage
       or new.sort_order is distinct from old.sort_order
       or new.approved_at is distinct from old.approved_at
       or (new.status = 'approved' and old.status <> 'approved') then
      raise exception 'Contractor cannot change protected or customer-controlled milestone fields';
    end if;
  end if;
  return new;
end
$$;

commit;
