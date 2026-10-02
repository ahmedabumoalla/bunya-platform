import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
const require = createRequire(import.meta.url);
const path = 'src/components/contractor/ContractorProfileEditor.tsx';
const source = fs.readFileSync(path,'utf8');
const parse = value => ts.createSourceFile('profile.tsx',value,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function contracts(code) {
  const file=parse(code),fields=[],operations={};
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node))&&['input','select','textarea'].includes(node.tagName.getText(file))) {
      const attributes={tag:node.tagName.getText(file)};
      for(const item of node.attributes.properties) if(ts.isJsxAttribute(item)&&['value','required','readOnly','type','min','max','dir','rows','onChange'].includes(item.name.text)) attributes[item.name.text]=item.initializer?.getText(file).replace(/\s/g,'')||true;
      fields.push(attributes);
    }
    if(ts.isVariableDeclaration(node)&&['load','save'].includes(node.name.getText(file))) operations[node.name.getText(file)]=node.initializer.getText(file);
    ts.forEachChild(node,visit);
  }
  visit(file);
  return {fields:fields.sort((a,b)=>a.value.localeCompare(b.value)),operations};
}
const fields=contracts(source).fields;
assert.equal(fields.length,11);
for(const field of ['displayName','commercialName','city','badge','yearsExperience','summary','googleMapsUrl','professionalLinks','availability']) {
  const control=fields.find(item=>item.value===`{form.${field}}`);
  assert.ok(control,`Missing editable field ${field}`);
  assert.ok(control.onChange);
  assert.equal(Boolean(control.required),['displayName','commercialName','city','badge','yearsExperience','summary'].includes(field));
}
assert.equal(fields.filter(item=>item.readOnly).length,2);
const years=fields.find(item=>item.value==='{form.yearsExperience}');assert.equal(years.min,'"0"');assert.equal(years.max,'"100"');assert.equal(years.type,'"number"');
assert.equal(fields.find(item=>item.value==='{form.googleMapsUrl}').type,'"url"');
const values=[],effects=[]; let cursor=0,saved,saveId,failLoad=false,failSave=false;
const row={id:'owner-profile',display_name:'مقاول الاختبار',commercial_name:'منشأة الاختبار',city:'الرياض',badge:'أعمال التشطيب',years_experience:12,summary:'نبذة المقاول',google_maps_url:'https://maps.test.invalid',professional_links:['https://test.invalid'],availability:'available',approval_status:'needs_changes',subscription_active:true,directory_visible:false,average_rating:4.5,projects_count:3,phone:'0500000000',email:'test@example.invalid'};
const db={from(table){assert.equal(table,'contractor_profiles');return {select(value){assert.equal(value,'*');return this;},update(value){saved=value;if(!failSave)Object.assign(row,value);return this;},eq(key,value){assert.equal(key,'id');saveId=value;return this;},single:async()=>({data:failLoad?null:row,error:failLoad?{message:'Profile read failed'}:null}),then(resolve){return Promise.resolve({error:failSave?{message:'Profile update failed'}:null}).then(resolve);}};}};
const hooks={...React,useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},useCallback:fn=>fn,useEffect:fn=>effects.push(fn)};
const exportsObject={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:exportsObject,require(name){if(name==='react')return hooks;if(name.includes('AuthIdentityProvider'))return{useAuthIdentity:()=>({details:{contractor:{contractorProfileId:'owner-profile'}}})};if(name.includes('supabase/client'))return{createClient:()=>db};if(name.endsWith('.module.css'))return{default:new Proxy({},{get:(_,key)=>key})};return require(name);}});
const render=()=>{cursor=0;effects.length=0;return exportsObject.ContractorProfileEditor();};
const nodes=(tree,predicate)=>{if(!tree||typeof tree!=='object')return[];if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,predicate));return[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];};
(async()=>{
  let tree=render();assert.match(renderToStaticMarkup(tree),/role="status"/);effects[0]();await new Promise(resolve=>setImmediate(resolve));tree=render();
  let html=renderToStaticMarkup(tree);
  assert.match(html,/عمولة المشاريع/);assert.doesNotMatch(html,/>الاشتراك</);assert.doesNotMatch(html,/>needs_changes</);assert.match(html,/مطلوب تعديل البيانات/);assert.match(html,/للقراءة فقط/);assert.doesNotMatch(html,/<main/);
  for(const id of ['identity','experience','location','contact']) {assert.match(html,new RegExp(`href="#profile-${id}"`));assert.match(html,new RegExp(`id="profile-${id}"`));}
  assert.equal(nodes(tree,node=>['input','textarea','select'].includes(node.type)).length,11);
  let summary=nodes(tree,node=>node.type==='textarea'&&node.props.value===row.summary)[0];summary.props.onChange({target:{value:'  نبذة محدثة  '}});tree=render();
  await nodes(tree,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});tree=render();html=renderToStaticMarkup(tree);
  assert.equal(saveId,'owner-profile');
  assert.deepEqual(JSON.parse(JSON.stringify(saved)),{display_name:'مقاول الاختبار',commercial_name:'منشأة الاختبار',city:'الرياض',badge:'أعمال التشطيب',years_experience:12,summary:'نبذة محدثة',google_maps_url:'https://maps.test.invalid',professional_links:['https://test.invalid'],availability:'available',sensitive_changes_pending_review:true});
  assert.match(html,/تم حفظ الملف المهني/);assert.match(html,/role="status"/);
  failSave=true;
  await nodes(tree,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});tree=render();html=renderToStaticMarkup(tree);
  assert.match(html,/Profile update failed/);assert.match(html,/role="alert"/);assert.doesNotMatch(html,/تم حفظ الملف المهني/);assert.equal(nodes(tree,node=>node.props?.type==='submit')[0].props.disabled,false);
  values.length=0;failLoad=true;render();effects[0]();await new Promise(resolve=>setImmediate(resolve));tree=render();html=renderToStaticMarkup(tree);
  assert.match(html,/Profile read failed/);assert.equal(nodes(tree,node=>node.type==='form').length,0);
  failLoad=false;
  nodes(tree,node=>node.type==='button'&&node.props.children==='إعادة المحاولة')[0].props.onClick();await new Promise(resolve=>setImmediate(resolve));tree=render();
  assert.equal(nodes(tree,node=>node.type==='form').length,1);
  const css=fs.readFileSync('src/components/contractor/ContractorProfileEditor.module.css','utf8');postcss.parse(css);
  for(const match of source.matchAll(/styles\.([A-Za-z]+)/g))assert.match(css,new RegExp(`\\.${match[1]}(?:[\\s{.:>,]|$)`),`Missing style ${match[1]}`);
  function l(hex){const c=hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
  for(const [fg,bg] of [['ffffff','173f32'],['5d7167','f3f6f3'],['79552f','faf3e9'],['8b3c32','faeeeb'],['985535','ffffff']])assert.ok((Math.max(l(fg),l(bg))+.05)/(Math.min(l(fg),l(bg))+.05)>=4.5);
  console.log('PASS 9 editable + 2 read-only controls/constraints; loaded SSR sections/Arabic status/contact; complete save payload, success/error feedback, failed load/retry; CSS classes/parse; five text contrast pairs');
})().catch(error=>{console.error(error);process.exitCode=1;});
