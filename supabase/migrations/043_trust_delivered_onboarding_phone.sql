begin;

create temp table delivered_join_phones(
  user_id uuid primary key,
  auth_phone text not null
) on commit drop;

with delivered as (
  select onboarding.auth_user_id as user_id,
         regexp_replace(application.mobile, '[^0-9]', '', 'g') as digits
  from public.account_onboarding_deliveries onboarding
  join public.provider_applications application
    on onboarding.application_kind = 'provider'
   and onboarding.application_id = application.id
  where application.status = 'approved'
    and onboarding.whatsapp_delivery_status = 'sent'
  union all
  select onboarding.auth_user_id,
         regexp_replace(application.mobile, '[^0-9]', '', 'g')
  from public.account_onboarding_deliveries onboarding
  join public.contractor_applications application
    on onboarding.application_kind = 'contractor'
   and onboarding.application_id = application.id
  where application.status = 'approved'
    and onboarding.whatsapp_delivery_status = 'sent'
), normalized as (
  select user_id,
         case
           when digits ~ '^05[0-9]{8}$' then '966' || substr(digits, 2)
           when digits ~ '^5[0-9]{8}$' then '966' || digits
           when digits ~ '^9665[0-9]{8}$' then digits
         end as auth_phone
  from delivered
)
insert into delivered_join_phones(user_id, auth_phone)
select user_id, auth_phone
from normalized candidate
where auth_phone is not null
  and not exists (
    select 1 from auth.users other
    where other.phone = candidate.auth_phone
      and other.id <> candidate.user_id
  )
on conflict (user_id) do nothing;

update auth.users account
set phone = candidate.auth_phone,
    phone_confirmed_at = coalesce(account.phone_confirmed_at, now()),
    updated_at = now()
from delivered_join_phones candidate
where account.id = candidate.user_id
  and (account.phone is distinct from candidate.auth_phone
    or account.phone_confirmed_at is null);

delete from public.phone_verification_challenges challenge
using delivered_join_phones candidate
where challenge.user_id = candidate.user_id;

commit;
