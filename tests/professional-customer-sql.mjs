import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const migration = name => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g,'\n');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fn = (text,name) => text.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0];
await db.exec(readFileSync('tests/fixtures/rfq-catalog.sql','utf8'));
const onboardingFixture = readFileSync('tests/contractor-join-sql.mjs','utf8');
for(const table of ['provider_applications','providers','provider_members','provider_profiles','provider_settings','admin_roles','admin_users','admin_permissions','admin_role_permissions','user_roles','account_onboarding_deliveries','join_request_reviews','audit_logs','provider_delivery_regions']) {
  await db.exec(onboardingFixture.match(new RegExp(`create table ${table}\\([\\s\\S]*?\\);`))[0]);
}
await db.exec(`
create unique index role_active on user_roles(profile_id,role) where revoked_at is null;
create unique index role_primary on user_roles(profile_id) where is_primary and revoked_at is null;
alter table profiles add column is_active boolean default true, add column role text default 'customer', add column mobile text, add column updated_at timestamptz, add column username text, add column full_name text, add column email text, add column must_change_password boolean, add column temporary_password_issued_at timestamptz, add column temporary_password_expires_at timestamptz, add column password_changed_at timestamptz;
create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz);
create table contractor_profiles(profile_id uuid primary key,approval_status text);
create table provider_product_prices(product_id uuid,provider_id uuid,expires_at timestamptz,freshness_status text);
create table product_availability_regions(product_id uuid,city text);
alter table products add column provider_id uuid,add column sku text,add column category_id uuid,add column custom_category text;
alter table quote_request_items add column variant_selections jsonb default '[]',add column variant_label_snapshot text;
create function public.admin_has_permission(text) returns boolean language sql as $$ select true $$;
insert into profiles(id,role,mobile) values('${id(2)}','provider','+966500000002'),('${id(3)}','contractor','+966500000003'),('${id(4)}','provider','+966500000004'),('${id(5)}','customer',null);
insert into auth.users(id) select id from profiles;
insert into providers(id,owner_profile_id,company_name,contact_name,status) values('${id(20)}','${id(2)}','Supplier','Owner','approved'),('${id(21)}','${id(4)}','Other supplier','Owner','approved');
insert into provider_members values('${id(20)}','${id(2)}','owner',true),('${id(21)}','${id(4)}','owner',true);
insert into user_roles(profile_id,role,is_primary) values('${id(2)}','provider',true),('${id(3)}','contractor',true),('${id(4)}','provider',true),('${id(5)}','customer',true);
insert into user_roles(profile_id,role,is_primary,revoked_at) values('${id(2)}','customer',false,now());
insert into contractor_profiles values('${id(3)}','approved');
update products set provider_id='${id(20)}',category_id='${id(30)}' where id='20000000-0000-4000-8000-000000000003';
insert into products(id,name,base_unit,provider_id,category_id) values('20000000-0000-4000-8000-000000000004','Different name in same category','tonne','${id(21)}','${id(30)}');
insert into product_availability_regions values('20000000-0000-4000-8000-000000000004','جدة');
`);
await db.exec(migration('081_canonical_rfq_catalog_selections.sql'));
const searchMigration=migration('092_contractor_sequential_project_search.sql');
await db.exec(fn(searchMigration,'has_verified_customer_identity'));
await db.exec(searchMigration.match(/revoke all on function public\.has_verified_customer_identity\(uuid\)[^;]+;/)[0]);
const sql=migration('093_professional_customer_accounts.sql');
const previousMatcher=fn(migration('071_category_tender_and_partial_quotes.sql'),'match_rfq_providers');
assert.equal(fn(sql,'match_rfq_providers').split('  select candidate.id from candidates')[0],previousMatcher.split('  select id from candidates')[0],'Preserve complete latest071 eligibility; only final self-exclusion SELECT changes');
await db.exec(sql);
const one = async(query,args=[]) => (await db.query(query,args)).rows[0];
const actor = n => db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);
assert.equal((await one("select count(*)::int n from customer_profiles where profile_id in ($1,$2,$3)",[id(2),id(3),id(4)])).n,3);
assert.deepEqual((await db.query("select role,is_primary from user_roles where profile_id=$1 and revoked_at is null order by role",[id(2)])).rows,[{role:'customer',is_primary:false},{role:'provider',is_primary:true}]);
assert.equal((await one("select count(*)::int n from user_roles where profile_id=$1 and role='customer'",[id(2)])).n,2,'Revoked history survives backfill');
await db.exec(sql);
assert.equal((await one("select count(*)::int n from user_roles where profile_id=$1 and role='customer'",[id(2)])).n,2,'Backfill idempotency');
for(const professional of [2,3]) { await actor(professional); await db.exec('select initialize_customer_account()'); }
assert.equal((await one('select mobile from profiles where id=$1',[id(2)])).mobile,'+966500000002');
await actor(5);await assert.rejects(db.exec('select initialize_customer_account()'),/Verified customer required/);
await db.exec(`update auth.users set phone='966500000005',phone_confirmed_at=now() where id='${id(5)}'`);await db.exec('select initialize_customer_account()');
assert.equal((await one('select mobile from profiles where id=$1',[id(5)])).mobile,'+966500000005');
await actor(2);
const request={city:'الرياض',desired_receipt_at:new Date(Date.now()+86400000).toISOString(),delivery_mode:'delivery'};
const items=[{product_id:'20000000-0000-4000-8000-000000000003',unit:'piece',quantity:1}];
const submitted=await one('select submit_customer_rfq($1::jsonb,$2::jsonb,$3) id',[JSON.stringify(request),JSON.stringify(items),'professional-customer-rfq']);
assert.ok(submitted.id);
assert.deepEqual((await db.query('select provider_id from internal_sourcing_request_targets')).rows,[{provider_id:id(21)}]);
assert.equal((await one('select requester_id,requester_role from quote_requests where id=$1',[submitted.id])).requester_role,'customer');
// Latest071 matches category-only products across names, units and regions; also retains custom category and name alternatives.
await db.exec(`update products set category_id=null,custom_category='Custom material' where id in('20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004')`);
assert.deepEqual((await db.query("select * from match_rfq_providers('20000000-0000-4000-8000-000000000003','الرياض','delivery')")).rows,[{matched_provider_id:id(21)}]);
await db.exec(`update products set custom_category=null,name='Unitless catalog product' where id='20000000-0000-4000-8000-000000000004'`);
assert.deepEqual((await db.query("select * from match_rfq_providers('20000000-0000-4000-8000-000000000003','الرياض','delivery')")).rows,[{matched_provider_id:id(21)}]);
await db.exec(`update user_roles set revoked_at=now() where profile_id='${id(2)}' and role='customer' and revoked_at is null`);
await assert.rejects(db.query('select submit_customer_rfq($1::jsonb,$2::jsonb,$3)',[JSON.stringify(request),JSON.stringify(items),'revoked-customer-rfq']),/Verified customer required/);
await db.exec(`update profiles set is_active=false where id='${id(2)}'`);await assert.rejects(db.exec('select initialize_customer_account()'),/Authentication required/);
await actor(4);await db.exec(`update providers set status='suspended' where id='${id(21)}'`);await assert.rejects(db.exec('select initialize_customer_account()'),/Verified customer required/);
await assert.rejects(db.query('select submit_customer_rfq($1::jsonb,$2::jsonb,$3)',[JSON.stringify(request),JSON.stringify(items),'suspended-professional-direct']),/Verified customer required/);
await actor(3);await db.exec(`update contractor_profiles set approval_status='rejected' where profile_id='${id(3)}'`);
await assert.rejects(db.query('select submit_customer_rfq($1::jsonb,$2::jsonb,$3)',[JSON.stringify(request),JSON.stringify(items),'rejected-professional-direct']),/Verified customer required/);
await db.exec(`update contractor_profiles set approval_status='approved' where profile_id='${id(3)}';update user_roles set revoked_at=now() where profile_id='${id(3)}' and role='contractor'`);
await assert.rejects(db.query('select submit_customer_rfq($1::jsonb,$2::jsonb,$3)',[JSON.stringify(request),JSON.stringify(items),'revoked-professional-direct']),/Verified customer required/);
// A former professional can still shop through independently verified customer credentials.
await db.exec(`update auth.users set phone='966500000003',phone_confirmed_at=now() where id='${id(3)}'`);
assert.ok((await one('select submit_customer_rfq($1::jsonb,$2::jsonb,$3) id',[JSON.stringify(request),JSON.stringify(items),'verified-former-professional'])).id);
// Exercise the real service-only provider approval, including preservation of an existing customer row.
await db.exec(`insert into profiles(id,role,full_name,is_active) values('${id(8)}','customer','New account',true);insert into auth.users(id) values('${id(8)}');insert into customer_profiles values('${id(8)}');insert into user_roles(profile_id,role,is_primary) values('${id(8)}','customer',true);insert into admin_roles values('${id(10)}','super_admin');insert into admin_users values('${id(11)}','${id(9)}','${id(10)}',true);insert into provider_applications(id,company_name,contact_name,mobile,email,requested_username,delivery_available) values('${id(12)}','New supplier','Owner','+966500000008','new@example.invalid','NewSupplier',false);`);
await db.query('select finalize_provider_application_approval($1,$2,$3,$4)',[id(12),id(8),id(9),'Approved fixture']);
assert.deepEqual((await db.query('select role,is_primary from user_roles where profile_id=$1 and revoked_at is null order by role',[id(8)])).rows,[{role:'customer',is_primary:false},{role:'provider',is_primary:true}]);
assert.equal((await one('select count(*)::int n from customer_profiles where profile_id=$1',[id(8)])).n,1);
assert.equal((await one("select extract(epoch from (temporary_password_expires_at-temporary_password_issued_at))/3600 hours from profiles where id=$1",[id(8)])).hours,'24.0000000000000000');
for(const name of ['has_verified_customer_identity(uuid)','is_approved_professional_customer(uuid)','match_rfq_providers(uuid,text,text)','finalize_provider_application_approval(uuid,uuid,uuid,text)']) assert.equal((await one('select has_function_privilege($1,$2,$3) allowed',['authenticated',name,'execute'])).allowed,false);
// The storefront wrapper invokes the initializer; validate its actual call remains in place.
assert.match(fn(migration('076_verified_customer_account_repair.sql'),'submit_storefront_rfq'),/perform public.initialize_customer_account\(\)/);
await db.close();
console.log('PASS actual093 migration/backfill idempotency, primary/history preservation, full RFQ071 category/custom/name matching across units/regions with self-exclusion, direct RPC revoked/inactive/suspended/approval denials and verified-customer fallback, actual provider approval, function ACLs');
