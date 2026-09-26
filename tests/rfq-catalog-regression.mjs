import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

// Runs only an ephemeral local PostgreSQL instance. Never reads credentials or connects remotely.
// Install PGlite separately, then pass PGLITE_MODULE_PATH or --pglite-module <path/to/dist/index.js>.
// Without an explicit path, resolves @electric-sql/pglite from normal Node package resolution.
const moduleFlag = process.argv.indexOf('--pglite-module');
const modulePath = process.env.PGLITE_MODULE_PATH ?? (moduleFlag >= 0 ? process.argv[moduleFlag + 1] : undefined);
const { PGlite } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : '@electric-sql/pglite');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const db = new PGlite();
const migration = async (name) => readFile(resolve(root, 'supabase/migrations', name), 'utf8');
const functionSource = (sql, name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `Missing function ${name}`);
  const end = sql.indexOf('$$;', start);
  assert.ok(end >= 0, `Missing function terminator ${name}`);
  return sql.slice(start, end + 3);
};
const ids = {
  product: '20000000-0000-4000-8000-000000000001',
  otherProduct: '20000000-0000-4000-8000-000000000002',
  unitlessProduct: '20000000-0000-4000-8000-000000000003',
  unit: '30000000-0000-4000-8000-000000000001',
  boxUnit: '30000000-0000-4000-8000-000000000002',
  otherUnit: '30000000-0000-4000-8000-000000000003',
  measurement: '40000000-0000-4000-8000-000000000001',
  boxMeasurement: '40000000-0000-4000-8000-000000000002',
  otherMeasurement: '40000000-0000-4000-8000-000000000003',
  red: '50000000-0000-4000-8000-000000000001',
  blue: '50000000-0000-4000-8000-000000000002',
  large: '50000000-0000-4000-8000-000000000003',
  inactive: '50000000-0000-4000-8000-000000000004',
  otherVariant: '50000000-0000-4000-8000-000000000005',
};
const item = (patch = {}) => ({
  product_id: ids.product, unit_id: ids.unit, unit: 'piece',
  measurement_id: ids.measurement, measurement: '10 x 20',
  quantity: 2, variant_ids: [ids.red, ids.large], ...patch,
});
let sequence = 0;
const submit = async (items, key = `fixture-key-${++sequence}`) => {
  const request = {city: 'Riyadh', desired_receipt_at: new Date(Date.now() + 86400000).toISOString(), delivery_mode: 'delivery'};
  const result = await db.query('select public.submit_customer_rfq($1::jsonb,$2::jsonb,$3::text) as id', [JSON.stringify(request), JSON.stringify(items), key]);
  return result.rows[0].id;
};
const persistedCounts = async () => (await db.query(`select
  (select count(*) from quote_requests)::int as requests,
  (select count(*) from quote_request_items)::int as items,
  (select count(*) from internal_sourcing_requests)::int as sourcing,
  (select count(*) from internal_sourcing_request_items)::int as sourcing_items,
  (select count(*) from internal_sourcing_request_targets)::int as targets,
  (select count(*) from outbox_events)::int as outbox`)).rows[0];
const rejectWithoutWrites = async (label, candidate, expected = undefined) => {
  const before = await persistedCounts();
  await assert.rejects(() => submit(candidate), expected, label);
  assert.deepEqual(await persistedCounts(), before, `${label}: failed submission persisted rows`);
  console.log(`PASS ${label}`);
};

try {
  await db.exec(await readFile(resolve(here, 'fixtures/rfq-catalog.sql'), 'utf8'));
  const base = await migration('001_bunya_production_schema.sql');
  await db.exec(functionSource(base, 'validate_quote_item_references'));
  await db.exec('create trigger quote_request_items_validate_references before insert or update on public.quote_request_items for each row execute function public.validate_quote_item_references();');
  const localized = await migration('062_multilingual_profiles_and_operational_snapshots.sql');
  await db.exec(functionSource(localized, 'snapshot_product_translations'));
  await db.exec(functionSource(localized, 'localize_snapshot'));
  await db.exec('create trigger quote_request_items_snapshot_translations before insert or update of product_id,unit_id,measurement_id on public.quote_request_items for each row execute function public.snapshot_product_translations();');
  const baseline = await migration('069_quote_item_measurements_and_variants.sql');
  const prefix = baseline.slice(0, baseline.indexOf('create or replace function public.get_provider_rfq_context'));
  await db.exec(`${prefix}\ncommit;`);
  const validId = await submit([item()]);
  const valid = (await db.query('select * from public.quote_request_items where request_id=$1', [validId])).rows[0];
  assert.equal(valid.unit_name_translations.en, 'Translated unit');
  assert.equal(valid.measurement_label_translations.en, 'Translated measurement');
  await rejectWithoutWrites('069 variant group guard', [item({variant_ids: [ids.red]})], /Select every product variant group/);
  const gapId = await submit([item({unit:'Invented unit', measurement:'Invented measurement', quantity:1})]);
  const gap = (await db.query('select * from public.quote_request_items where request_id=$1', [gapId])).rows[0];
  assert.equal(gap.unit_name_snapshot, 'Invented unit');
  assert.equal(Number(gap.quantity), 1);
  console.log('PASS actual 069 baseline confirms quantity/label gap and preserves actual reference/translation triggers');
  if (process.argv.includes('--baseline')) {
    console.log('READY local in-memory PostgreSQL fixture; no live database calls.');
  } else {
    const files = (await readdir(resolve(root, 'supabase/migrations'))).filter((name) => /^081_.*\.sql$/.test(name));
    assert.equal(files.length, 1, 'Expected exactly one 081 migration');
    await db.exec(await migration(files[0]));
    console.log(`PASS loaded ${files[0]}`);
    const canonicalId = await submit([item({unit:'Untrusted label', measurement:'Untrusted label'})]);
    const canonical = (await db.query('select * from public.quote_request_items where request_id=$1', [canonicalId])).rows[0];
    assert.equal(canonical.unit_id, ids.unit);
    assert.equal(canonical.measurement_id, ids.measurement);
    assert.equal(canonical.unit_name_snapshot, 'piece');
    assert.equal(canonical.measurement_label_snapshot, '10 x 20');
    assert.equal(canonical.unit_name_translations.en, 'Translated unit');
    assert.equal(canonical.measurement_label_translations.en, 'Translated measurement');
    assert.deepEqual(canonical.product_specifications_snapshot, ['Manufacturer: Fixture brand']);
    assert.deepEqual(canonical.variant_selections.map((selected) => selected.id), [ids.red, ids.large]);
    const source = (await db.query('select * from internal_sourcing_request_items where quote_request_item_id=$1', [canonical.id])).rows[0];
    assert.equal(source.unit_snapshot, 'piece');
    assert.equal(source.measurement_snapshot, '10 x 20');
    console.log('PASS canonical IDs, labels, translation snapshots, variants and sourcing snapshots');

    const invalidItems = [
      ['foreign product unit', {unit_id:ids.otherUnit}],
      ['foreign product measurement', {measurement_id:ids.otherMeasurement}],
      ['measurement belongs to different unit', {measurement_id:ids.boxMeasurement}],
      ['below minimum', {quantity:1}],
      ['zero quantity', {quantity:0}],
      ['negative quantity', {quantity:-1}],
      ['excess precision', {quantity:2.0001}],
      ['quantity overflow', {quantity:100000000000}],
      ['business quantity maximum', {quantity:1000000.001}],
      ['not a number quantity', {quantity:'NaN'}],
      ['infinite quantity', {quantity:'Infinity'}],
      ['missing quantity', {quantity:undefined}],
      ['unknown product', {product_id:'20000000-0000-4000-8000-999999999999'}],
      ['missing variant group', {variant_ids:[ids.red]}],
      ['missing all variants', {variant_ids:[]}],
      ['duplicate variant IDs', {variant_ids:[ids.red,ids.red,ids.large]}],
      ['two values for one variant group', {variant_ids:[ids.red,ids.blue,ids.large]}],
      ['inactive variant', {variant_ids:[ids.inactive,ids.large]}],
      ['foreign product variant', {variant_ids:[ids.otherVariant,ids.large]}],
    ];
    for (const [name, patch] of invalidItems) await rejectWithoutWrites(name, [item(patch)]);
    for (const [name, items] of [['null item list',null],['empty item list',[]],['non-array item list',{}],['null item',[null]],['too many items',Array.from({length:51},()=>item())]]) {
      await rejectWithoutWrites(name, items);
    }
    await rejectWithoutWrites('invalid second line rolls back first line and whole request', [item(),item({quantity:1})]);
    await rejectWithoutWrites('splitting duplicate below-minimum lines cannot bypass minimum', [item({quantity:1}),item({quantity:1})]);
    for (const [column, value] of [['is_published',false],['review_status','pending_review'],['availability_status','unavailable']]) {
      const previous = (await db.query(`select ${column} as value from products where id=$1`, [ids.product])).rows[0].value;
      await db.query(`update products set ${column}=$1 where id=$2`, [value, ids.product]);
      try { await rejectWithoutWrites(`unavailable catalog: ${column}`, [item()]); }
      finally { await db.query(`update products set ${column}=$1 where id=$2`, [previous, ids.product]); }
    }
    const replayKey = 'fixture-replay-preserved';
    const original = await submit([item()], replayKey);
    const countBeforeReplay = await persistedCounts();
    await db.query('update products set minimum_order=5 where id=$1',[ids.product]);
    try { assert.equal(await submit([item()], replayKey), original); }
    finally { await db.query('update products set minimum_order=2 where id=$1',[ids.product]); }
    assert.deepEqual(await persistedCounts(), countBeforeReplay);
    console.log('PASS idempotent replay survives catalog change and creates no duplicate rows');
    const permission = (await db.query(`select
      has_function_privilege('authenticated','public.submit_customer_rfq(jsonb,jsonb,text)','execute') as public_submit,
      has_function_privilege('anon','public.submit_customer_rfq(jsonb,jsonb,text)','execute') as anonymous_submit,
      has_function_privilege('authenticated','public.canonicalize_rfq_catalog_item(jsonb)','execute') as private_helper`)).rows[0];
    assert.deepEqual(permission, {public_submit:true,anonymous_submit:false,private_helper:false});
    console.log('PASS submission execute grants and private catalog helper permissions');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    try { await rejectWithoutWrites('unauthenticated submission', [item()], /Authentication required/); }
    finally { await db.query("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false)"); }
    await db.query('delete from customer_profiles');
    try { await rejectWithoutWrites('missing customer capability', [item()], /Verified customer required/); }
    finally { await db.query("insert into customer_profiles values('00000000-0000-4000-8000-000000000001')"); }
    const fractionalId = await submit([item({quantity:2.125})]);
    assert.equal(Number((await db.query('select quantity from quote_request_items where request_id=$1',[fractionalId])).rows[0].quantity),2.125);
    console.log('PASS supported three-decimal quantity persists exactly');
    const maxId = await submit([item({quantity:1000000})]);
    assert.equal(Number((await db.query('select quantity from quote_request_items where request_id=$1',[maxId])).rows[0].quantity),1000000);
    console.log('PASS maximum supported quantity');
    for (const [name, patch] of [
      ['measurement ID derives unit', {unit_id:undefined,unit:'Untrusted translated label'}],
      ['reviewed labels resolve IDs', {unit_id:undefined,unit:'Translated unit',measurement_id:undefined,measurement:'Translated measurement'}],
      ['sole offered measurement inferred', {measurement_id:undefined,measurement:undefined}],
    ]) {
      const id = await submit([item(patch)]);
      const row = (await db.query('select unit_id,measurement_id from quote_request_items where request_id=$1',[id])).rows[0];
      assert.deepEqual(row,{unit_id:ids.unit,measurement_id:ids.measurement},name);
      console.log(`PASS ${name}`);
    }
    await rejectWithoutWrites('legacy known unit conflicts with measurement ID',[item({unit_id:undefined,unit:'box'})]);
    const extraMeasurement='40000000-0000-4000-8000-000000000004';
    await db.query('insert into product_measurements(id,product_id,unit_id,label) values($1,$2,$3,$4)',[extraMeasurement,ids.product,ids.unit,'20 x 40']);
    try { await rejectWithoutWrites('multiple measurements require explicit selection',[item({measurement_id:undefined,measurement:undefined})]); }
    finally { await db.query('delete from product_measurements where id=$1',[extraMeasurement]); }
    const fallback = item({product_id:ids.unitlessProduct,unit_id:null,measurement_id:null,measurement:null,variant_ids:[]});
    const fallbackId = await submit([fallback]);
    const fallbackRow = (await db.query('select unit_id,measurement_id,unit_name_snapshot,unit_name_translations,measurement_label_translations from quote_request_items where request_id=$1',[fallbackId])).rows[0];
    assert.deepEqual(fallbackRow,{unit_id:null,measurement_id:null,unit_name_snapshot:'piece',unit_name_translations:{},measurement_label_translations:{}});
    await rejectWithoutWrites('base fallback rejects invented unit',[{...fallback,unit:'invented'}]);
    console.log('PASS explicit base-unit fallback without invented measurement');

    const providerContext = (await db.query('select get_provider_rfq_context($1) as result',[source.id])).rows[0].result;
    assert.deepEqual(providerContext.product_specifications_snapshot,['Manufacturer: Fixture brand']);
    assert.equal(providerContext.unit_snapshot,'Translated unit');
    const providerList = (await db.query('select get_my_provider_rfq_list() as result')).rows[0].result;
    assert.deepEqual(providerList.find((entry)=>entry.sourcing_request_item_id===source.id).product_specifications_snapshot,['Manufacturer: Fixture brand']);
    console.log('PASS actual provider detail/list wrappers expose saved specifications and localized IDs (base authorization stubbed)');

    const draftId = (await db.query("insert into quote_requests(requester_id,status) values(auth.uid(),'draft') returning id")).rows[0].id;
    const draftItem = (await db.query(`insert into quote_request_items(request_id,product_id,unit_id,measurement_id,quantity,
      product_name_snapshot,unit_name_snapshot,measurement_label_snapshot,variant_selections,
      variant_label_snapshot,product_specifications_snapshot,unit_name_translations)
      values($1,$2,$3,$4,2,'Forged product','Forged unit','Forged measure',$5,'Forged variant',array['Forged specification'],'{"en":"Forged translation"}'::jsonb) returning *`,
      [draftId,ids.product,ids.unit,ids.measurement,JSON.stringify([{id:ids.red,name:'forged',attributes:{color:'forged'}},{id:ids.large}])])).rows[0];
    assert.equal(draftItem.product_name_snapshot,'Fixture product');
    assert.equal(draftItem.unit_name_snapshot,'piece');
    assert.equal(draftItem.measurement_label_snapshot,'10 x 20');
    assert.equal(draftItem.variant_selections[0].name,'Red');
    assert.deepEqual(draftItem.variant_selections[0].attributes,{color:'red'});
    assert.deepEqual(draftItem.product_specifications_snapshot,['Manufacturer: Fixture brand']);
    assert.equal(draftItem.unit_name_translations.en,'Translated unit');
    const editedDraft = (await db.query("update quote_request_items set product_specifications_snapshot=array['Forged edit'],unit_name_snapshot='Forged edit',variant_label_snapshot='Forged edit' where id=$1 returning *",[draftItem.id])).rows[0];
    assert.deepEqual(editedDraft.product_specifications_snapshot,['Manufacturer: Fixture brand']);
    assert.equal(editedDraft.unit_name_snapshot,'piece');
    assert.equal(editedDraft.variant_label_snapshot,canonical.variant_label_snapshot);
    await assert.rejects(()=>db.query('update quote_request_items set quantity=1 where id=$1',[draftItem.id]),/minimum order/);
    assert.equal(Number((await db.query('select quantity from quote_request_items where id=$1',[draftItem.id])).rows[0].quantity),2);
    console.log('PASS direct draft insert/update canonicalizes forged snapshots and rejects minimum bypass');

    await db.query("update products set minimum_order=10,availability_status='unavailable' where id=$1",[ids.product]);
    try {
      const historical = (await db.query("update quote_request_items set unit_name_translations='{" + '"en":"Forged history translation"' + "}'::jsonb where request_id=$1 returning unit_name_translations,product_specifications_snapshot",[gapId])).rows[0];
      assert.equal(historical.unit_name_translations.en,'Translated unit');
      assert.deepEqual(historical.product_specifications_snapshot,[]);
      const noChange = (await db.query('update quote_request_items set quantity=quantity where id=$1 returning quantity',[canonical.id])).rows[0];
      assert.equal(Number(noChange.quantity),2);
    } finally { await db.query("update products set minimum_order=2,availability_status='available' where id=$1",[ids.product]); }
    console.log('PASS historical translation maintenance/no-op update avoids current catalog revalidation and leaves historical specifications empty');

    const switched = (await db.query(`update quote_request_items set product_id=$1,unit_id=null,measurement_id=null,
      product_name_snapshot='Unitless catalog product',unit_name_snapshot='piece',measurement_label_snapshot=null,
      variant_selections='[]'::jsonb,variant_label_snapshot=null,product_specifications_snapshot='{}'::text[]
      where id=$2 returning product_name_translations,unit_name_translations,measurement_label_translations`,[ids.unitlessProduct,draftItem.id])).rows[0];
    assert.deepEqual(switched,{product_name_translations:{},unit_name_translations:{},measurement_label_translations:{}},'Switching draft to base-unit fallback must clear obsolete translation snapshots');
    console.log('PASS draft product switch clears obsolete unit and measurement translations');

    const catalogReferences = (await db.query(`select conname,confdeltype from pg_constraint
      where conrelid='public.quote_request_items'::regclass and contype='f'
      and confrelid in ('public.products'::regclass,'public.product_units'::regclass,'public.product_measurements'::regclass)`)).rows;
    assert.equal(catalogReferences.length,3);
    assert.ok(catalogReferences.every(reference => reference.confdeltype === 'r'),'RFQ catalog references must preserve the actual ON DELETE RESTRICT contract');
    const quoteItemDefinition = base.slice(base.indexOf('create table public.quote_request_items ('),base.indexOf('create index quote_request_items_request_idx'));
    for (const table of ['products','product_units','product_measurements']) {
      assert.ok(new RegExp(`references public\\.${table} \\(id\\) on delete restrict`).test(quoteItemDefinition),`${table}: fixture differs from migration001 FK action`);
    }
    const beforeDelete = (await db.query('select * from quote_request_items where id=$1',[canonical.id])).rows[0];
    for (const [table,catalogId] of [['products',ids.product],['product_units',ids.unit],['product_measurements',ids.measurement]]) {
      await assert.rejects(()=>db.query(`delete from ${table} where id=$1`,[catalogId]),error => error.code === '23503',`${table}: referenced deletion must remain blocked by the foreign key`);
      assert.deepEqual((await db.query('select * from quote_request_items where id=$1',[canonical.id])).rows[0],beforeDelete,'Blocked catalog deletion must leave all operational snapshots intact');
    }
    const unusedMeasurement='40000000-0000-4000-8000-000000000099';
    await db.query('insert into product_measurements(id,product_id,unit_id,label) values($1,$2,$3,$4)',[unusedMeasurement,ids.product,ids.unit,'Unused catalog option']);
    await db.query('delete from product_measurements where id=$1',[unusedMeasurement]);
    assert.equal((await db.query('select count(*)::int as count from product_measurements where id=$1',[unusedMeasurement])).rows[0].count,0);
    console.log('PASS actual RFQ RESTRICT foreign keys block referenced deletes without changing snapshots; unreferenced option deletion still succeeds');
    console.log('PASS RFQ catalog PostgreSQL regression cases; fixture only, no live database calls.');
  }
} finally {
  await db.close();
}
