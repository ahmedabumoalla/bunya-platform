begin;

alter table public.notifications disable trigger notifications_protect_payload;
delete from public.notifications
where type='delivery_confirmed'
  and entity_id='d2d701a4-b852-4eab-a375-22e19809295f';
alter table public.notifications enable trigger notifications_protect_payload;

delete from public.outbox_events
where idempotency_key='delivery-confirmed:d2d701a4-b852-4eab-a375-22e19809295f';

delete from public.delivery_confirmation_attempts
where assignment_id='d2d701a4-b852-4eab-a375-22e19809295f';
delete from public.delivery_confirmation_records
where assignment_id='d2d701a4-b852-4eab-a375-22e19809295f';

alter table public.provider_delivery_assignments
  disable trigger provider_delivery_assignment_transition;
alter table public.provider_delivery_assignments
  disable trigger provider_delivery_transition_event;
update public.provider_delivery_assignments
set status='arrived',delivered_at=null,delivery_note='أعيد فتح التوصيل لاختبار رمز العميل',updated_at=now()
where id='d2d701a4-b852-4eab-a375-22e19809295f'
  and order_id='19af324f-8b6f-4f47-b1f6-979e828e65aa';
alter table public.provider_delivery_assignments
  enable trigger provider_delivery_assignment_transition;
alter table public.provider_delivery_assignments
  enable trigger provider_delivery_transition_event;

alter table public.internal_fulfillment_orders
  disable trigger internal_fulfillment_orders_protect;
update public.internal_fulfillment_orders
set status='out_for_delivery',updated_at=now()
where id='d099cfd3-e83b-4bd3-85f9-b9b56a1328c8';
alter table public.internal_fulfillment_orders
  enable trigger internal_fulfillment_orders_protect;

alter table public.orders disable trigger orders_validate_transition;
update public.orders
set status='out_for_delivery',completed_at=null,updated_at=now()
where id='19af324f-8b6f-4f47-b1f6-979e828e65aa';
alter table public.orders enable trigger orders_validate_transition;

insert into public.provider_delivery_updates(
  assignment_id,from_status,to_status,actor_role,actor_user_id,note
) values(
  'd2d701a4-b852-4eab-a375-22e19809295f','delivered','arrived','admin',null,
  'إعادة فتح اختبار رمز التسليم بطلب العميل'
);

insert into public.fulfillment_status_history(
  fulfillment_order_id,from_status,to_status,actor_profile_id,note
) values(
  'd099cfd3-e83b-4bd3-85f9-b9b56a1328c8','delivered','out_for_delivery',null,
  'إعادة فتح اختبار رمز التسليم بطلب العميل'
);

commit;
