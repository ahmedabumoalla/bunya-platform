begin;

do $$
begin
  if to_regclass('public.products') is null
    or to_regclass('public.product_units') is null
  then
    raise exception '033 requires the product catalog schema';
  end if;
end
$$;

create or replace function public.sync_product_base_unit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_unit_id uuid;
begin
  update public.product_units
     set is_base = false
   where product_id = new.id
     and is_base
     and lower(name) <> lower(new.base_unit);

  select id
    into v_unit_id
    from public.product_units
   where product_id = new.id
     and lower(name) = lower(new.base_unit)
   limit 1;

  if v_unit_id is null then
    insert into public.product_units(product_id, name, sort_order, is_base)
    values (new.id, new.base_unit, 0, true);
  else
    update public.product_units
       set name = new.base_unit,
           is_base = true,
           sort_order = least(sort_order, 0)
     where id = v_unit_id;
  end if;

  return new;
end
$$;

drop trigger if exists products_sync_base_unit on public.products;
create trigger products_sync_base_unit
after insert or update of base_unit on public.products
for each row execute function public.sync_product_base_unit();

update public.product_units unit
   set is_base = false
  from public.products product
 where unit.product_id = product.id
   and unit.is_base
   and lower(unit.name) <> lower(product.base_unit);

update public.product_units unit
   set name = product.base_unit,
       is_base = true,
       sort_order = least(unit.sort_order, 0)
  from public.products product
 where unit.product_id = product.id
   and lower(unit.name) = lower(product.base_unit);

insert into public.product_units(product_id, name, sort_order, is_base)
select product.id, product.base_unit, 0, true
  from public.products product
 where not exists (
   select 1
     from public.product_units unit
    where unit.product_id = product.id
      and lower(unit.name) = lower(product.base_unit)
 );

revoke execute on function public.sync_product_base_unit()
  from public, anon, authenticated;

commit;
