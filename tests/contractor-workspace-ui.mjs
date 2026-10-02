import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync('src/components/contractor/ContractorWorkspace.tsx', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const profile = { display_name: 'مقاول الاختبار', approval_status: 'approved', subscription_active: true, city: 'الرياض', badge: 'مقاول', summary: 'تنفيذ المشاريع' };
const project = { id: 'project-1', name: 'مشروع الاختبار', project_code: 'PR-1', status: 'in_progress', project_value: 24000, progress: 42, payment_status: 'paid', scope: 'تنفيذ نطاق المشروع', start_at: '2026-10-01', expected_end_at: '2026-11-01' };
const proposal = { id: 'proposal-1', proposal_code: 'Q-1', opportunity_id: 'opportunity-1', status: 'needs_changes', amount: 16000, vat_inclusive: true, execution_duration: 'شهر', change_request: 'توضيح نطاق العمل' };
const review = { id: 'review-1', rating: 4, commitment: 4, quality: 5, communication: 4, timeliness: 3, comment: 'عمل جيد', contractor_projects: { name: 'مشروع الاختبار' }, contractor_review_replies: [{ reply: 'شكرًا لتقييمكم' }] };
const document = { id: 'doc-1', file_name: 'إثبات النشاط.pdf', document_type: 'commercial_registration', status: 'approved', signed_url: '/api/contractor/documents/doc-1', application_id: 'application-1' };
function harness(states, options = {}) {
  let cursor = 0;
  const writes = [], stateChanges = [];
  const db = { from(table) { return { select() { return this; }, eq() { return this; }, order() { return this; }, maybeSingle() { return this; }, single() { return this; }, async insert(payload) { writes.push({ table, method: 'insert', payload }); if (options.rejectWrite) throw Error('offline'); return { error: null }; }, async upsert(payload, config) { writes.push({ table, method: 'upsert', payload, config }); if (options.rejectWrite) throw Error('offline'); return { error: null }; }, then(resolve, reject) { return Promise.resolve({ data: table === 'contractor_projects' ? project : [], error: null }).then(resolve, reject); } }; }, async rpc(name, args) { writes.push({ method: 'rpc', name, args }); return { error: null }; } };
  const exports = {};
  class FormValues { constructor(element) { this.values = element.fields; } get(key) { return this.values[key] ?? null; } }
  vm.runInNewContext(code, { exports, FormData: FormValues, Date, console, require(name) {
    if (name === 'react') return { ...React, useState(initial) { const index = cursor++; return [index < states.length ? states[index] : initial, value => stateChanges.push({ index, value })]; }, useEffect() {}, useCallback(callback) { return callback; } };
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'next/link') return { default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (name === '@/components/auth/AuthIdentityProvider') return { useAuthIdentity: () => ({ userId: 'owner-1', details: { contractor: { contractorProfileId: 'contractor-1' } } }) };
    if (name === '@/lib/supabase/client') return { createClient: () => db };
    if (name === '@/lib/uploads/client') return { optimizeUploadFile() { throw Error('Unexpected upload'); } };
    if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw Error(`Unexpected dependency ${name}`);
  } });
  return { writes, stateChanges, render(name, props = {}) { cursor = 0; return exports[name](props); } };
}
const html = (name, states, props) => renderToStaticMarkup(harness(states).render(name, props));
const views = [
  ['ContractorOpportunities', [[{ opportunity_id: 'opportunity-1', title: 'فرصة تشطيب', description: 'أعمال داخلية', city: 'الرياض', region: 'الوسطى' }], profile, false, ''], '/contractor/opportunities/opportunity-1'],
  ['ContractorProjects', [[project], false, ''], '/contractor/projects/project-1'],
  ['ContractorProposals', [[proposal], false, ''], '/contractor/proposals/proposal-1'],
  ['ContractorProjectComments', [[{ id: 'comment-1', comment_code: 'C-1', type: 'budget_change', status: 'pending_admin_review', body: 'طلب تعديل', admin_note: 'مراجعة النطاق', customer_decision_note: 'تفاصيل إضافية' }], false, ''], 'مراجعة النطاق'],
  ['ContractorReviews', [[review], false, '', ''], 'تحديث الرد'],
];
for (const [name, states, expected] of views) {
  const loaded = html(name, states); assert.ok(loaded.includes(expected), name); assert.match(loaded, /ملخص النشاط/);
  const empty = html(name, [[], ...states.slice(1)]); assert.match(empty, /class="empty"/); assert.doesNotMatch(empty, /NaN|undefined/);
}
const dashboard = html('ContractorDashboard', [profile, { opportunities: 7, proposals: 3, projects: 2, reviews: 1, documents: 1, services: 1, portfolio: 1 }, false, '']);
assert.match(dashboard, /٧/); assert.match(dashboard, /href="\/contractor\/opportunities"/); assert.match(dashboard, /اكتشف المشاريع المناسبة لك/); assert.doesNotMatch(dashboard, /قاعدة البيانات|NaN/);
const unsubscribedDashboard = html('ContractorDashboard', [{ ...profile, subscription_active: false }, {}, false, '']);
assert.match(unsubscribedDashboard, /اكتشف المشاريع المناسبة لك/); assert.doesNotMatch(unsubscribedDashboard, /فعّل اشتراكك|تفعيل اشتراك المقاول/);
assert.match(html('ContractorOpportunities', [[], { ...profile, subscription_active: false }, false, '']), /حسابك جاهز/);
assert.match(html('ContractorDashboard', [{ ...profile, approval_status: 'pending' }, {}, false, '']), /جهّز حسابك/);
const details = html('ContractorProjectDetail', [project, [{ id: 'stage-1', name: 'مرحلة التنفيذ', status: 'in_progress', progress: 50, value_percentage: 20 }], [{ id: 'update-1', title: 'تحديث', description: 'تفاصيل التحديث', update_type: 'daily_report' }], false, '', ''], { id: project.id });
assert.doesNotMatch(details, /قيمة العمولة المتفق عليها/);
const commissioned = html('ContractorProjectDetail', [{ ...project, platform_commission_rate: 5, platform_commission_amount: 1200 }, [], [], false, '', ''], { id: project.id });
assert.match(commissioned, /قيمة العمولة المتفق عليها/); assert.match(commissioned, /٥%/); assert.match(commissioned, /١٬٢٠٠/);
assert.match(details, /حالة المشروع/); assert.match(details, /إرسال لاعتماد العميل/); assert.match(details, /تسجيل تأخير/); assert.match(details, /تقرير يومي/); assert.doesNotMatch(details, />[^<]*daily_report/);
const proposalDetails = html('ContractorProposalDetail', [proposal, [{ id: 'stage-2', name: 'خطة العمل', value_percentage: 100 }], false, ''], { id: proposal.id });
assert.match(proposalDetails, /حالة العرض/); assert.match(proposalDetails, /تعديل العرض وإرساله/);
const verification = html('ContractorVerification', [profile, [document], false, false, '', 'تم رفع المستند']);
assert.match(verification, /role="status"/); assert.match(verification, /scope="col"/); assert.match(verification, /tabindex="0"/); assert.match(verification, /\/api\/contractor\/documents\/doc-1/); assert.doesNotMatch(verification, />حذف<\/button>/);
const pendingDoc = html('ContractorVerification', [profile, [{ ...document, status: 'pending_review', application_id: null }], false, false, '', '']);
assert.match(pendingDoc, /حذف المستند/); assert.match(html('ContractorVerification', [profile, [], false, false, '', '']), /لم ترفع مستندات بعد/);
assert.match(html('ContractorProjects', [[], true, '']), /role="status"/); assert.match(html('ContractorProjects', [[], false, 'تعذر الاتصال']), /role="alert"/);
assert.match(html('ContractorProjectDetail', [null, [], [], false, '', 'تعذر الاتصال'], { id: 'missing' }), /تعذر الاتصال/);
console.log('PASS nine workspace views: populated/empty/loading/error, account readiness, Arabic status, document deletion gates and navigation');

function findElements(node, type, result = []) {
  if (!React.isValidElement(node)) return result;
  if (node.type === type) result.push(node);
  React.Children.forEach(node.props.children, child => findElements(child, type, result));
  return result;
}
for (const rejectWrite of [false, true]) {
  const h = harness([project, [], [], false, '', ''], { rejectWrite });
  const tree = h.render('ContractorProjectDetail', { id: project.id });
  const form = findElements(tree, 'form')[0]; let resets = 0;
  const event = { preventDefault() {}, currentTarget: { fields: { type: 'daily_report', title: 'تقدم الأعمال', description: 'تفاصيل تقدم الأعمال' }, reset() { resets++; } } };
  const result = form.props.onSubmit(event); event.currentTarget = null; await result; await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.writes[0].table, 'contractor_project_updates'); assert.equal(h.writes[0].payload.contractor_profile_id, 'contractor-1'); assert.equal(h.writes[0].payload.project_id, project.id); assert.equal(h.writes[0].payload.update_type, 'daily_report'); assert.equal(resets, rejectWrite ? 0 : 1); assert.ok(h.stateChanges.some(change => change.index === 4 && change.value === ''));
  if (rejectWrite) assert.ok(h.stateChanges.some(change => change.index === 5 && String(change.value).includes('تعذر حفظ')));
}
{
  const h = harness([[review], false, '', '']); const form = findElements(h.render('ContractorReviews'), 'form')[0];
  form.props.onSubmit({ preventDefault() {}, currentTarget: { fields: { reply: 'شكرًا لتقييمكم' } } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.writes[0].table, 'contractor_review_replies'); assert.equal(h.writes[0].payload.review_id, review.id); assert.equal(h.writes[0].payload.contractor_profile_id, 'contractor-1'); assert.equal(h.writes[0].config.onConflict, 'review_id');
}
console.log('PASS captured update/reply handlers: owned payloads, asynchronous reset, failure recovery and existing upsert contract');
