import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { File } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const productId='00000000-0000-4000-8000-000000000001';
const providerId='00000000-0000-4000-8000-000000000002';
const imageId='00000000-0000-4000-8000-000000000003';
const categoryId='00000000-0000-4000-8000-000000000004';
const compile=file=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const createCode=compile('src/app/api/provider/products/route.ts');
const changeCode=compile('src/app/api/provider/products/[id]/change-requests/route.ts');
const imageTones={};
vm.runInNewContext(compile('src/lib/products/image-tone.ts'),{exports:imageTones});
class PublicJoinError extends Error { constructor(message,status){super(message);this.status=status;} }

function harness({authenticated=true,foreign=false,published=true,category=null,categoryError=false}={}){
  const writes=[],calls=[];
  const identity=authenticated?{status:'ready',activeRoles:['provider'],userId:'owner',details:{provider:{providerId,companyName:'Supplier'}}}:null;
  const db={
    from(table){
      let operation='select',payload;
      const filters={};
      const result=()=>{
        if(table==='product_categories')return {data:category?.id===filters.id&&category?.is_active===filters.is_active?{slug:category.slug}:null,error:categoryError?{message:'category lookup failed'}:null};
        if(operation==='insert')return {data:table==='products'?{id:productId}:null,error:null};
        if(table==='products')return {data:{id:productId,provider_id:foreign?'another-provider':providerId,review_status:published?'approved':'draft',is_published:published},error:null};
        if(table==='product_images')return {data:[{id:imageId,storage_path:`${providerId}/${productId}/image.jpg`,is_primary:true,sort_order:0}],error:null};
        if(table==='admin_users')return {data:[{profile_id:'reviewer'}],error:null};
        return {data:[],error:null};
      };
      const q={select(){return this;},eq(key,value){filters[key]=value;return this;},in(){return this;},order(){return this;},insert(value){operation='insert';payload=value;writes.push({table,payload});return this;},delete(){operation='delete';writes.push({table,operation});return this;},single:async()=>result(),maybeSingle:async()=>result(),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};
      return q;
    },
    storage:{from(){return {upload:async()=>({error:null}),remove:async()=>({error:null})};}},
    async rpc(name,args){calls.push({name,args});return {data:{request_id:'change-request'},error:null};},
  };
  function load(code){
    const exports={};
    vm.runInNewContext(code,{exports,Response,FormData,File,crypto:webcrypto,Date,process:{env:{}},console:{error(){}},require(name){
      if(name==='@/lib/auth/server')return {getAuthIdentity:async()=>identity};
      if(name==='@/lib/supabase/server')return {createClient:async()=>db};
      if(name==='@/lib/supabase/admin')return {createAdminClient:()=>db};
      if(name==='@/lib/products/image-tone')return imageTones;
      if(name==='@/lib/auth/resolve-identity')return {resolveAuthIdentity:async()=>identity};
      if(name==='@/lib/auth/request-client')return {createAuthRequestClient:async()=>({user:authenticated?{id:'owner'}:null,usesBearer:true,supabase:db}),isLocalAppOrigin:()=>false,authRouteResponse:(_,body,status)=>Response.json(body,{status}),authRouteOptions:()=>new Response(null,{status:204})};
      if(name==='@/lib/join/security')return {PublicJoinError,assertSameOrigin(){throw Error('Unexpected cookie request');}};
      if(name.includes('notifications'))return {dispatchNotificationEvent(){throw Error('Unexpected notification');},dispatchProductReviewNotifications(){throw Error('Unexpected notification');}};
      if(name==='next/server')return {};
      throw Error(`Unexpected import ${name}`);
    }});
    return exports;
  }
  return {create:load(createCode).POST,change:load(changeCode).POST,writes,calls};
}
function form(extra={}){
  const values={name:'Construction material',category_id:'other',custom_category:'Custom category',base_unit:'piece',description:'A detailed product description',offer_type:'sale',minimum_order:'200',availability_status:'available',lead_time_label:'Within two days',delivery_window:'Morning',delivery_notes:'Coordinate delivery',retained_image_ids:JSON.stringify([imageId]),...extra};
  const data=new FormData();for(const [key,value] of Object.entries(values))data.set(key,value);return data;
}
const request=data=>({formData:async()=>data,headers:new Headers()});
let cases=0;
for(const obsolete of [{},{unit_price:'2.70',vat_inclusive:'on'},{unit_price:'invalid',vat_inclusive:'false'}]){
  for(const intent of ['draft','pending_review']){
    const h=harness(),data=form({...obsolete,intent});
    if(intent==='pending_review')data.append('images',new File(['test-image'],'product.jpg',{type:'image/jpeg'}));
    const response=await h.create(request(data));
    assert.equal(response.status,201,await response.text());
    const product=h.writes.find(row=>row.table==='products').payload;
    assert.equal(product.unit_price,null);
    assert.equal(Object.hasOwn(product,'vat_inclusive'),false);
    assert.equal(product.minimum_order,200);
    assert.equal(product.provider_id,providerId);
    cases++;
  }
  const h=harness(),response=await h.change(request(form(obsolete)),{params:Promise.resolve({id:productId})});
  assert.equal(response.status,201,await response.text());
  assert.equal(h.calls[0].name,'submit_product_change_request');
  const core=h.calls[0].args.p_proposed_snapshot.core;
  assert.equal(Object.hasOwn(core,'unit_price'),false);
  assert.equal(Object.hasOwn(core,'vat_inclusive'),false);
  assert.equal(core.minimum_order,200);
  cases++;
}
for(const extra of [{name:''},{minimum_order:'0'},{stock_quantity:'-1'},{offer_type:'rental'},{availability_status:'limited'}]){
  const h=harness();
  assert.equal((await h.create(request(form(extra)))).status,400);
  assert.equal((await h.change(request(form(extra)),{params:Promise.resolve({id:productId})})).status,400);
  assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);cases++;
}
{
  const h=harness();
  assert.equal((await h.create(request(form({intent:'pending_review'})))).status,400);
  assert.equal((await h.change(request(form({retained_image_ids:'[]'})),{params:Promise.resolve({id:productId})})).status,400);
  assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);cases++;
}
for(const [options,status] of [[{authenticated:false},401],[{foreign:true},404],[{published:false},409]]){
  const h=harness(options);
  assert.equal((await h.change(request(form()),{params:Promise.resolve({id:productId})})).status,status);
  if(!options.authenticated&&Object.hasOwn(options,'authenticated'))assert.equal((await h.create(request(form()))).status,401);
  assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);cases++;
}
for(const [slug,tone] of Object.entries({cement:'cement',steel:'steel','blocks-bricks':'blocks',insulation:'insulation',plumbing:'plumbing',electrical:'electric',wood:'wood',paint:'paint','tools-equipment':'tools','future-active-category':'tools'})){
  const h=harness({category:{id:categoryId,slug,is_active:true}});
  const data=form({category_id:categoryId,intent:'pending_review'});
  data.append('images',new File(['image'],'product.jpg',{type:'image/jpeg'}));
  const response=await h.create(request(data));
  assert.equal(response.status,201,`${slug}: ${await response.text()}`);
  assert.equal(h.writes.find(row=>row.table==='products').payload.category_id,categoryId);
  assert.equal(h.writes.find(row=>row.table==='product_images').payload.tone,tone);
  const changed=await h.change(request(form({category_id:categoryId})),{params:Promise.resolve({id:productId})});
  assert.equal(changed.status,201,`${slug}: ${await changed.text()}`);
  assert.equal(h.calls[0].args.p_proposed_snapshot.images[0].tone,tone);
  cases++;
}
for(const options of [{},{category:{id:categoryId,slug:'cement',is_active:false}},{category:{id:categoryId,slug:'cement',is_active:true},categoryError:true}]){
  const h=harness(options);
  assert.equal((await h.create(request(form({category_id:categoryId})))).status,400);
  assert.equal((await h.change(request(form({category_id:categoryId})),{params:Promise.resolve({id:productId})})).status,400);
  assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);cases++;
}
console.log(`PASS: ${cases} catalog API cases; all nine live category slugs and future active categories accepted with valid image tones, absent/inactive/error categories denied, price-free contracts and ownership preserved. No real DB writes or messages.`);
