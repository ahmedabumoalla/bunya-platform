import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load=(path,mocks={})=>{const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>mocks[name]??{}});return exports;};
const compact=load('src/lib/notifications/compact.ts');
const id='7b23f499-2578-4a02-bc1d-3863a90877d0';
assert.equal(compact.shortReference(id),'7B23F499');assert.equal(compact.shortReference('Q-2026-001'),'Q-2026-001');assert.equal(compact.shortReference(null),'');
assert.equal(compact.compactText('أهلًا\n\tبك  هنا',20),'أهلًا بك هنا');assert.equal(compact.compactText('😀'.repeat(8),5),'😀😀😀😀…');
const legacy=`طلب انضمام مقاول جديد\nرقم الطلب الفريد: ${id}\nوقت التقديم: 2026-10-12T15:38:44\nبيانات مقدم الطلب:\nالاسم بالعربية: شركة الاختبار\nالجوال: +966500000004\nالبريد الإلكتروني: private@invalid.example\nالتخصصات: PRIVATE DETAILS\nالمراجعة: https://invalid.example/admin`;
const preview=compact.notificationPreview(legacy);assert.match(preview,/شركة الاختبار/);assert.match(preview,/\+966500000004/);assert.match(preview,/7B23F499/);assert.doesNotMatch(preview,/PRIVATE|@|2026-|https:|2578-4a02/);assert.ok(preview.length<=120);
const sent=[],records=[];
const decision=load('src/lib/notifications/send-join-applicant-decision.ts',{'./compact':compact,'./site-url':{OFFICIAL_PLATFORM_URL:'https://invalid.example'},'./providers/green-api':{maskWhatsAppDestination:()=> 'masked',sendGreenApiMessage:async input=>{sent.push(input);return{status:'submitted'};}},'./providers/resend':{sendResendSensitiveCopy:async input=>{sent.push(input);return{status:'submitted'};}},'./submissions':{maskEmail:()=> 'masked',recordProviderSubmission:async input=>{records.push(input);}}});
for(const action of ['rejected','needs_changes'])await decision.sendJoinApplicantDecision({kind:'contractor',action,applicationId:id,applicantName:'شركة الاختبار',email:'private@invalid.example',mobile:'0500000004',reason:'PRIVATE FULL REVIEW '.repeat(30),revisionUrl:'https://invalid.example/join/revise/SECRET-TOKEN',idempotencyKey:'unchanged-'+action});
assert.equal(sent.length,4);assert.equal(records.length,4);
for(const input of sent){assert.match(input.text,/7B23F499/);assert.ok(input.text.length<220);assert.doesNotMatch(input.text,/PRIVATE|private@|2578-4a02/);assert.match(input.idempotencyKey,/^unchanged-/);}
assert.ok(sent.slice(2).every(input=>input.text.includes('/join/revise/SECRET-TOKEN')&&input.text.includes('48 ساعة')));
console.log('PASS short display references, unchanged business codes, Unicode limits, compact legacy notices and concise decisions with intact secure links/idempotency. No sends.');
