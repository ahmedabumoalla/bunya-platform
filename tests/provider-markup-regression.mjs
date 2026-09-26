import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Local in-memory PostgreSQL only. No credentials, network clients or remote database URLs.
const moduleFlag = process.argv.indexOf('--pglite-module');
const modulePath = process.env.PGLITE_MODULE_PATH ?? (moduleFlag >= 0 ? process.argv[moduleFlag + 1] : undefined);
const { PGlite } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : '@electric-sql/pglite');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here,'..');
const migration = name => readFile(resolve(root,'supabase/migrations',name),'utf8');
const db = new PGlite();
const extract = (sql,startText,endText='$$;') => {
  const start=sql.indexOf(startText);
  assert.ok(start>=0,`Missing SQL source ${startText}`);
  const end=sql.indexOf(endText,start);
  assert.ok(end>=0,`Unterminated SQL source ${startText}`);
  return sql.slice(start,end+endText.length);
};
const fn=(sql,name)=>extract(sql,`create or replace function public.${name}(`);
const table=(sql,name)=>extract(sql,`create table public.${name} (`,'\n);');
const actor='00000000-0000-4000-8000-000000000001';
const otherActor='00000000-0000-4000-8000-000000000002';
const setAdmin=async flag=>db.query("select set_config('fixture.admin',$1,false)",[String(flag)]);
const counts=async()=> (await db.query(`select
  (select count(*) from orders)::int as orders,(select count(*) from order_items)::int as order_items,
  (select count(*) from invoices)::int as invoices,(select count(*) from invoice_items)::int as invoice_items,
  (select count(*) from payment_records)::int as payments,
  (select count(*) from internal_fulfillment_orders)::int as fulfillments,
  (select count(*) from financial_transactions)::int as transactions`)).rows[0];
const assemble=async source=>(await db.query('select assemble_bunya_customer_quote($1) as id',[source])).rows[0].id;
const accept=async(quote,key=`accept-fixture-${++sequence}`)=>(await db.query('select accept_customer_quote($1,$2) as id',[quote,key])).rows[0].id;
const quoteLines=async quote=>(await db.query('select * from bunya_customer_quote_items where bunya_customer_quote_id=$1 order by quote_request_item_id',[quote])).rows;
const money=value=>Number(value);
const actorSetting=async id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
const rowAsAuthenticated=async(sql,params=[])=>{
  await db.exec('set role authenticated');
  try{return await db.query(sql,params);}finally{await db.exec('reset role');}
};
let sequence=0;
async function seed(lines){
  const request=(await db.query('insert into quote_requests(requester_id) values($1) returning id',[actor])).rows[0].id;
  const source=(await db.query(`insert into internal_sourcing_requests(internal_code,customer_request_id,stage,expected_ready_at,response_deadline_at)
    values($1,$2,'comparing_prices',now()+interval '1 hour',now()+interval '30 minutes') returning id`,[`SRC-FIXTURE-${++sequence}`,request])).rows[0].id;
  const ids=[];
  for(const line of lines){
    const item=(await db.query(`insert into quote_request_items(request_id,product_id,product_name_snapshot,quantity,measurement_label_snapshot)
      values($1,$2,'Fixture product',$3,$4) returning id`,[request,line.product,line.quantity??1,line.measurement??null])).rows[0].id;
    const sourcingItem=(await db.query(`insert into internal_sourcing_request_items(sourcing_request_id,quote_request_item_id,product_id,quantity,unit_snapshot,measurement_snapshot,delivery_region,required_at)
      values($1,$2,$3,$4,'piece',$5,'Riyadh',now()+interval '2 days') returning id`,[source,item,line.product,line.quantity??1,line.measurement??null])).rows[0].id;
    const response=(await db.query(`insert into provider_pricing_responses(response_code,sourcing_request_item_id,provider_id,receipt_confirmed_at,unit_price,vat_inclusive,price_confirmed_at,price_expires_at)
      values($1,$2,$3,now(),$4,$5,now(),now()+interval '60 hours') returning id`,[`RSP-FIXTURE-${++sequence}`,sourcingItem,line.provider,line.unitPrice,line.inclusive??true])).rows[0].id;
    await db.query('insert into internal_sourcing_request_targets(sourcing_request_item_id,provider_id,response_deadline_at) values($1,$2,now()+interval \'30 minutes\')',[sourcingItem,line.provider]);
    await db.query('insert into provider_availability_confirmations(pricing_response_id,available,available_quantity) values($1,true,$2)',[response,line.quantity??1]);
    await db.query('insert into provider_delivery_confirmations(pricing_response_id,region_eligible,preparation_duration_hours,delivery_duration_hours,delivery_fee) values($1,true,0,1,$2)',[response,line.delivery??0]);
    ids.push({item,sourcingItem,response});
  }
  return {request,source,items:ids};
}

try {
  const base=await migration('001_bunya_production_schema.sql');
  await db.exec([...base.matchAll(/create type public\.\w+ as enum \([^;]+;/g)].map(match=>match[0]).join('\n'));
  await db.exec(await readFile(resolve(here,'fixtures/provider-markup.sql'),'utf8'));
  for(const name of ['orders','order_items','order_status_history','financial_transactions','invoices','invoice_items','payment_records','outbox_events','idempotency_keys',
    'internal_sourcing_requests','internal_sourcing_request_items','internal_sourcing_request_targets','provider_pricing_responses','provider_availability_confirmations',
    'provider_delivery_confirmations','internal_selection_results','selected_provider_items','bunya_customer_quotes','bunya_customer_quote_items','internal_fulfillment_orders','internal_fulfillment_order_items']){
    await db.exec(table(base,name));
  }
  await db.exec(`alter table internal_sourcing_requests add column completed_at timestamptz;
    alter table bunya_customer_quote_items add column product_name_translations jsonb not null default '{}'::jsonb,
      add column unit_name_translations jsonb not null default '{}'::jsonb,
      add column measurement_label_translations jsonb not null default '{}'::jsonb;
    alter table internal_fulfillment_orders add column payment_released_at timestamptz;
    alter table outbox_events add column idempotency_key text;
    create unique index outbox_events_idempotency_idx on outbox_events(idempotency_key) where idempotency_key is not null;
    create unique index financial_transactions_fulfillment_type_unique on financial_transactions((metadata->>'fulfillment_order_id'),type) where metadata ? 'fulfillment_order_id';
    grant all on all tables in schema public to authenticated,service_role;
    insert into profiles(id) values('${actor}'),('${otherActor}');
    select set_config('request.jwt.claim.sub','${actor}',false);
    select set_config('fixture.admin','true',false);`);
  await db.exec(fn(base,'select_best_provider_price'));
  await db.exec(fn(base,'validate_bunya_customer_quote_transition'));
  await db.exec('create trigger bunya_customer_quotes_validate_transition before update of status on bunya_customer_quotes for each row execute function public.validate_bunya_customer_quote_transition();');
  await db.exec(fn(base,'accept_customer_quote'));
  await db.exec(fn(await migration('071_category_tender_and_partial_quotes.sql'),'assemble_bunya_customer_quote'));
  await db.exec(await migration('051_invoice_items_vat_inclusive.sql'));
  await db.exec('create constraint trigger orders_complete_acceptance after insert on orders deferrable initially deferred for each row execute function public.complete_accepted_order();');
  await db.exec(await migration('075_order_provider_financial_ledger_entries.sql'));
  const commissions=await migration('074_provider_commissions_and_finance_dashboard.sql');
  await db.exec(fn(commissions,'admin_set_provider_commission'));
  await db.exec(fn(commissions,'admin_provider_financial_summary'));
  await db.exec(fn(commissions,'record_provider_fulfillment_financials_trigger'));
  await db.exec(`create trigger internal_fulfillment_record_financials after update of payment_released_at on internal_fulfillment_orders
    for each row when(old.payment_released_at is null and new.payment_released_at is not null)
    execute function public.record_provider_fulfillment_financials_trigger();`);
  const provider=(await db.query("insert into providers(company_name,platform_commission_rate) values('Provider A',10) returning id")).rows[0].id;
  const providerB=(await db.query("insert into providers(company_name,platform_commission_rate) values('Provider B',20) returning id")).rows[0].id;
  const product=(await db.query("insert into products(name) values('Fixture product') returning id")).rows[0].id;
  if(process.argv.includes('--fixture')){
    const scenario=await seed([{provider,product,unitPrice:10}]);
    const quote=(await db.query('select assemble_bunya_customer_quote($1) as id',[scenario.source])).rows[0].id;
    assert.ok(quote,'Baseline assembly must succeed');
    assert.equal(Number((await db.query('select total from bunya_customer_quotes where id=$1',[quote])).rows[0].total),10);
    console.log('PASS actual financial schema/function fixture baseline: provider 10 currently sells for 10');
  } else {
    const legacyPaid=await seed([{provider,product,unitPrice:10}]);
    const legacyPaidQuote=await assemble(legacyPaid.source);
    const legacyPaidOrder=await accept(legacyPaidQuote);
    await db.query('update internal_fulfillment_orders set payment_released_at=now() where bunya_customer_quote_id=$1',[legacyPaidQuote]);
    const legacyTransactions=(await db.query('select * from financial_transactions where order_id=$1 order by created_at,id',[legacyPaidOrder])).rows;
    assert.deepEqual(legacyTransactions.map(row=>money(row.amount)),[10,-1]);
    const legacyReady=await seed([{provider,product,unitPrice:10}]);
    const legacyReadyQuote=await assemble(legacyReady.source);
    const legacyExclusive=await seed([{provider,product,unitPrice:10,inclusive:false}]);
    const legacyExclusiveQuote=await assemble(legacyExclusive.source);
    const files=(await readdir(resolve(root,'supabase/migrations'))).filter(name=>/^082_.*\.sql$/.test(name));
    assert.equal(files.length,1,'Expected one migration082');
    await db.exec(await migration(files[0]));
    console.log(`PASS loaded actual ${files[0]}`);
    assert.deepEqual((await db.query('select * from financial_transactions where order_id=$1 order by created_at,id',[legacyPaidOrder])).rows,legacyTransactions);
    assert.equal(await assemble(legacyReady.source),legacyReadyQuote);
    assert.equal(money((await db.query('select total from bunya_customer_quotes where id=$1',[legacyReadyQuote])).rows[0].total),10);
    const legacyExclusiveOrder=await accept(legacyExclusiveQuote);
    assert.equal(money((await db.query('select total from invoices where order_id=$1',[legacyExclusiveOrder])).rows[0].total),11.5);
    console.log('PASS legacy paid financial entries and previously offered legacy quote remain unchanged');

    const first=await seed([{provider,product,unitPrice:10}]);
    const firstQuote=await assemble(first.source);
    assert.ok(firstQuote,'New quote assembly failed');
    const firstLine=(await quoteLines(firstQuote))[0];
    assert.equal(money(firstLine.unit_price),11);
    assert.equal(money(firstLine.line_total),11);
    assert.equal(money(firstLine.subtotal),9.57);
    assert.equal(money(firstLine.vat_amount),1.43);
    const firstSnapshot=(await db.query('select * from bunya_quote_item_pricing_snapshots where quote_item_id=$1',[firstLine.id])).rows[0];
    assert.equal(money(firstSnapshot.supplier_unit_price),10);
    assert.equal(money(firstSnapshot.platform_commission_rate),10);
    assert.equal(money(firstSnapshot.supplier_total),10);
    assert.equal(money(firstSnapshot.customer_total),11);
    assert.equal(money(firstSnapshot.platform_markup_amount),1);
    assert.equal(money(firstSnapshot.platform_margin_amount),0.87);
    console.log('PASS provider cost 10 plus 10 percent gives customer 11 and private net margin 0.87');

    await db.query('select admin_set_provider_commission($1,75)',[provider]);
    assert.equal(await assemble(first.source),firstQuote);
    assert.deepEqual((await db.query('select * from bunya_quote_item_pricing_snapshots where quote_item_id=$1',[firstLine.id])).rows[0],firstSnapshot);
    await assert.rejects(()=>db.query('select select_best_provider_price($1)',[first.items[0].sourcingItem]));
    console.log('PASS issued ready quote is stable under rate changes, repeated assembly and selection calls');
    await setAdmin(false);
    await actorSetting(otherActor);
    const beforeUnauthorized=await counts();
    await assert.rejects(()=>accept(firstQuote),/Not authorized/);
    assert.deepEqual(await counts(),beforeUnauthorized);
    await actorSetting(actor);
    const order=await accept(firstQuote,'accept-fixed-first-quote');
    const countAfterAccept=await counts();
    assert.equal(await accept(firstQuote,'accept-fixed-first-quote'),order);
    assert.deepEqual(await counts(),countAfterAccept);
    const acceptedOrder=(await db.query('select * from orders where id=$1',[order])).rows[0];
    assert.equal(money(acceptedOrder.total),11);
    const firstInvoice=(await db.query('select * from invoices where order_id=$1',[order])).rows[0];
    assert.equal(money(firstInvoice.total),11);
    const firstInvoiceLines=(await db.query('select * from invoice_items where invoice_id=$1',[firstInvoice.id])).rows;
    assert.equal(firstInvoiceLines.length,1);
    assert.equal(money(firstInvoiceLines[0].line_total),11);
    assert.equal(firstInvoiceLines[0].vat_inclusive,true);
    assert.equal(money(firstInvoiceLines[0].vat_rate),15);
    assert.equal((await db.query('select bunya_customer_quote_item_id,vat_inclusive from order_items where order_id=$1',[order])).rows[0].bunya_customer_quote_item_id,firstLine.id);
    assert.equal(money((await db.query('select amount from payment_records where invoice_id=$1',[firstInvoice.id])).rows[0].amount),11);
    const firstFulfillment=(await db.query('select * from internal_fulfillment_orders where bunya_customer_quote_id=$1',[firstQuote])).rows[0];
    assert.equal(money(firstFulfillment.assigned_value),10);
    console.log('PASS changed current provider rate cannot change accepted quote/order/invoice/payment or supplier fulfillment cost; accept retries idempotent');

    await db.query('update internal_fulfillment_orders set payment_released_at=now() where id=$1',[firstFulfillment.id]);
    const newLedger=(await db.query('select * from financial_transactions where order_id=$1 order by created_at,id',[order])).rows;
    assert.deepEqual(newLedger.map(row=>[row.type,money(row.amount)]),[['order_amount',10]]);
    assert.equal(newLedger[0].metadata.pricing_model,'additive_markup_v1');
    assert.equal(money(newLedger[0].balance_after),19);
    const ledgerBeforeRetry=await counts();
    await db.query('select record_provider_fulfillment_financials($1)',[firstFulfillment.id]);
    await db.query('update internal_fulfillment_orders set payment_released_at=now() where id=$1',[firstFulfillment.id]);
    assert.deepEqual(await counts(),ledgerBeforeRetry);
    await setAdmin(true);
    const summary=(await db.query('select * from admin_provider_financial_summary() where provider_id=$1',[provider])).rows[0];
    assert.equal(money(summary.bunya_commission),1.87);
    assert.equal(money(summary.net_earned),19);
    assert.equal(money(summary.current_balance),19);
    console.log('PASS full supplier 10 credited without commission debit; release retries idempotent; admin profit counts net markup separately');

    const immutableQuoteBefore=(await db.query('select * from bunya_customer_quotes where id=$1',[firstQuote])).rows[0];
    try { await assemble(first.source); } catch(error) { assert.match(error.message,/accepted|order|closed|rebuild|assembled/i); }
    assert.deepEqual((await db.query('select * from bunya_customer_quotes where id=$1',[firstQuote])).rows[0],immutableQuoteBefore);
    await assert.rejects(()=>db.query('update bunya_quote_item_pricing_snapshots set platform_commission_rate=0 where quote_item_id=$1',[firstLine.id]));
    await assert.rejects(()=>db.query('delete from bunya_quote_item_pricing_snapshots where quote_item_id=$1',[firstLine.id]));
    assert.deepEqual((await db.query('select * from bunya_quote_item_pricing_snapshots where quote_item_id=$1',[firstLine.id])).rows[0],firstSnapshot);
    await assert.rejects(()=>db.query('update bunya_customer_quote_items set unit_price=unit_price+1 where id=$1',[firstLine.id]),/immutable/);
    await assert.rejects(()=>db.query('update selected_provider_items set unit_price=unit_price+1 where id=$1',[firstSnapshot.selected_provider_item_id]),/immutable/);
    await assert.rejects(()=>db.query('update bunya_customer_quotes set subtotal=subtotal+1 where id=$1',[firstQuote]),/immutable/);
    await assert.rejects(()=>db.query("update bunya_customer_quotes set status='preparing' where id=$1",[firstQuote]),/immutable|issued|preparing/i);
    const reviewedTranslation=(await db.query(`update bunya_customer_quote_items
      set product_name_translations='{"en":"Reviewed product"}'::jsonb,
      unit_name_translations='{"en":"Reviewed unit"}'::jsonb,
      measurement_label_translations='{"en":"Reviewed measurement"}'::jsonb
      where id=$1 returning unit_name_translations,unit_price`,[firstLine.id])).rows[0];
    assert.equal(reviewedTranslation.unit_name_translations.en,'Reviewed unit');
    assert.equal(money(reviewedTranslation.unit_price),11);
    console.log('PASS accepted quotes cannot reassemble and private financial snapshots are immutable');
    console.log('PASS customer/supplier monetary edits and preparing-reset bypass blocked while reviewed translation maintenance remains allowed');

    await setAdmin(false);
    assert.equal((await rowAsAuthenticated('select * from bunya_quote_item_pricing_snapshots')).rows.length,0);
    await db.query("select set_config('fixture.provider',$1,false)",[provider]);
    assert.equal((await rowAsAuthenticated('select * from bunya_quote_item_pricing_snapshots')).rows.length,0);
    await db.query("select set_config('fixture.provider','',false)");
    await db.exec('set role anon');
    try { await assert.rejects(()=>db.query('select * from bunya_quote_item_pricing_snapshots'),/permission denied/); }
    finally { await db.exec('reset role'); }
    await setAdmin(true);
    assert.ok((await rowAsAuthenticated('select * from bunya_quote_item_pricing_snapshots')).rows.length>0);
    await assert.rejects(()=>rowAsAuthenticated('update bunya_quote_item_pricing_snapshots set platform_commission_rate=0 where quote_item_id=$1',[firstLine.id]),/permission denied/);
    const publicCosts=(await db.query(`select table_name,column_name from information_schema.columns
      where table_schema='public' and table_name in ('bunya_customer_quotes','bunya_customer_quote_items','orders','order_items')
      and column_name ~ '(supplier|provider|commission|markup|cost)'`)).rows;
    assert.deepEqual(publicCosts,[]);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.record_provider_fulfillment_financials(uuid)','execute') as allowed")).rows[0].allowed,false);
    console.log('PASS private costs hidden by RLS, finance can read but cannot write, and customer rows contain no added supplier cost/rate fields');

    await db.query('select admin_set_provider_commission($1,10)',[provider]);
    const mixed=await seed([
      {provider,product,unitPrice:10,quantity:2,inclusive:true,delivery:5,measurement:'one'},
      {provider:providerB,product,unitPrice:20,quantity:2,inclusive:false,delivery:7,measurement:'two'},
    ]);
    const mixedQuote=await assemble(mixed.source);
    assert.ok(mixedQuote);
    const mixedSnapshots=(await db.query('select * from bunya_quote_item_pricing_snapshots where bunya_customer_quote_id=$1 order by supplier_unit_price',[mixedQuote])).rows;
    assert.equal(mixedSnapshots.length,2);
    assert.deepEqual(mixedSnapshots.map(row=>money(row.platform_commission_rate)),[10,20]);
    assert.deepEqual(mixedSnapshots.map(row=>money(row.supplier_total)),[25,53]);
    assert.deepEqual(mixedSnapshots.map(row=>money(row.customer_total)),[27,62.2]);
    assert.deepEqual(mixedSnapshots.map(row=>money(row.customer_unit_price)),[11,24]);
    assert.deepEqual(mixedSnapshots.map(row=>row.customer_vat_inclusive),[true,false]);
    const mixedOrder=await accept(mixedQuote);
    const mixedInvoice=(await db.query('select * from invoices where order_id=$1',[mixedOrder])).rows[0];
    const mixedInvoiceItems=(await db.query('select * from invoice_items where invoice_id=$1',[mixedInvoice.id])).rows;
    assert.equal(mixedInvoiceItems.length,2,'Equal product/quantity with different requested measurements must not multiply invoice lines');
    assert.ok(mixedInvoiceItems.every(line=>money(line.vat_rate)===15));
    assert.equal(money(mixedInvoice.total),89.2);
    assert.equal(mixedInvoiceItems.reduce((sum,row)=>sum+money(row.line_total),0),77.2);
    assert.equal(money(mixedInvoice.delivery_fee),12);
    const mixedFulfillments=(await db.query('select * from internal_fulfillment_orders where bunya_customer_quote_id=$1 order by assigned_value',[mixedQuote])).rows;
    assert.deepEqual(mixedFulfillments.map(row=>money(row.assigned_value)),[25,53]);
    await db.query('update internal_fulfillment_orders set payment_released_at=now() where bunya_customer_quote_id=$1',[mixedQuote]);
    assert.deepEqual((await db.query('select amount from financial_transactions where order_id=$1 order by amount',[mixedOrder])).rows.map(row=>money(row.amount)),[25,53]);
    const mixedSummary=(await db.query('select * from admin_provider_financial_summary() where provider_id=any($1::uuid[])',[[provider,providerB]])).rows;
    assert.equal(money(mixedSummary.find(row=>row.provider_id===provider).bunya_commission),3.61);
    assert.equal(money(mixedSummary.find(row=>row.provider_id===providerB).bunya_commission),8);
    assert.equal(money(mixedSummary.find(row=>row.provider_id===provider).net_earned),44);
    assert.equal(money(mixedSummary.find(row=>row.provider_id===providerB).net_earned),53);
    console.log('PASS mixed provider rates and inclusive/exclusive VAT, delivery passthrough, duplicate-product invoice isolation and supplier-specific ledger');

    await db.query('select admin_set_provider_commission($1,0)',[provider]);
    const zeroRateFractional=await seed([{provider,product,unitPrice:0.07,quantity:2.5,inclusive:false}]);
    const zeroRateQuote=await assemble(zeroRateFractional.source);
    assert.ok(zeroRateQuote,'Zero-rate fractional quote must assemble');
    const zeroSnapshot=(await db.query('select * from bunya_quote_item_pricing_snapshots where bunya_customer_quote_id=$1',[zeroRateQuote])).rows[0];
    assert.equal(money(zeroSnapshot.supplier_total),0.21);
    assert.equal(money(zeroSnapshot.customer_total),0.21);
    assert.equal(money(zeroSnapshot.platform_markup_amount),0);
    await accept(zeroRateQuote);
    console.log('PASS zero-percent markup preserves exact fractional supplier totals through invoice constraints');

    await db.query('select admin_set_provider_commission($1,10)',[provider]);
    const duplicate=await seed([{provider,product,unitPrice:10,measurement:'same'},{provider,product,unitPrice:10,measurement:'same'}]);
    const duplicateQuote=await assemble(duplicate.source);
    const duplicateOrder=await accept(duplicateQuote);
    const duplicateInvoice=(await db.query('select * from invoices where order_id=$1',[duplicateOrder])).rows[0];
    const duplicateLines=(await db.query('select * from invoice_items where invoice_id=$1',[duplicateInvoice.id])).rows;
    assert.equal(duplicateLines.length,2);
    assert.equal(money(duplicateInvoice.total),22);
    assert.ok(duplicateLines.every(line=>line.order_item_id!==null));
    assert.equal(new Set(duplicateLines.map(line=>line.order_item_id)).size,2,'Distinct quote source lines must keep distinct invoice/order associations');
    assert.equal((await db.query(`select count(*)::int as count from invoice_items invoice_item
      join order_items order_item on order_item.id=invoice_item.order_item_id
      join bunya_customer_quote_items quote_item on quote_item.id=order_item.bunya_customer_quote_item_id
      where invoice_item.invoice_id=$1 and quote_item.bunya_customer_quote_id=$2`,[duplicateInvoice.id,duplicateQuote])).rows[0].count,2);
    await db.query('update internal_fulfillment_orders set payment_released_at=now() where bunya_customer_quote_id=$1',[duplicateQuote]);
    assert.deepEqual((await db.query('select type,amount from financial_transactions where order_id=$1',[duplicateOrder])).rows.map(row=>[row.type,money(row.amount)]),[['order_amount',20]]);
    console.log('PASS identical quote-line signatures produce exactly two invoice lines and one full supplier credit, without guessed order association');

    for(const status of ['rejected','expired']){
      const closed=await seed([{provider,product,unitPrice:10}]);
      const closedQuote=await assemble(closed.source);
      await db.query('update bunya_customer_quotes set status=$1 where id=$2',[status,closedQuote]);
      const before=(await db.query('select * from bunya_customer_quotes where id=$1',[closedQuote])).rows[0];
      try{assert.equal(await assemble(closed.source),null);}catch(error){assert.match(error.message,/closed|rejected|expired|assembled|quote/i);}
      assert.deepEqual((await db.query('select * from bunya_customer_quotes where id=$1',[closedQuote])).rows[0],before);
    }
    console.log('PASS rejected and expired quote assembly cannot reopen customer terms');

    for(const testCase of [{unitPrice:0.05,quantity:1.001,rate:10,expectedUnit:0.06},{unitPrice:10,quantity:1,rate:0,expectedUnit:10},{unitPrice:10,quantity:1,rate:100,expectedUnit:20}]){
      await db.query('select admin_set_provider_commission($1,$2)',[provider,testCase.rate]);
      const sample=await seed([{provider,product,unitPrice:testCase.unitPrice,quantity:testCase.quantity}]);
      const quote=await assemble(sample.source);
      assert.ok(quote);
      const line=(await quoteLines(quote))[0];
      assert.equal(money(line.unit_price),testCase.expectedUnit);
      const sampleOrder=await accept(quote);
      const invoice=(await db.query('select * from invoices where order_id=$1',[sampleOrder])).rows[0];
      const invoiceLine=(await db.query('select * from invoice_items where invoice_id=$1',[invoice.id])).rows[0];
      assert.equal(money(invoiceLine.line_total),Number((money(line.subtotal)+money(line.vat_amount)).toFixed(2)));
      assert.equal(money(invoiceLine.vat_rate),15,'Known tax basis retains statutory VAT despite small-amount rounding');
    }
    for(const rate of [-1,100.01,'NaN','Infinity']) await assert.rejects(()=>db.query('select admin_set_provider_commission($1,$2)',[provider,rate]));
    await setAdmin(false);
    await assert.rejects(()=>db.query('select admin_set_provider_commission($1,10)',[provider]),/Finance permission required/);
    console.log('PASS fractional quantity and penny rounding, zero/100-percent rate boundaries, invalid rates and unauthorized rate changes');
    console.log('PASS provider markup financial regressions in isolated local PostgreSQL; no live connections');
  }
} finally { await db.close(); }
