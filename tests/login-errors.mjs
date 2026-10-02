import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/auth/login-errors.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const message=exports.loginErrorMessage;
// Observed response from the live access-token hook for an isolated expired fixture.
const expired={code:'unknown',status:403,name:'AuthApiError',message:'انتهت صلاحية كلمة المرور المؤقتة. اطلب من الإدارة إعادة إرسال بيانات الدخول.'};
assert.match(message(expired),/انتهت صلاحية كلمة المرور المؤقتة/);
assert.match(message(expired),/٢٤ ساعة/);
assert.doesNotMatch(message(expired),/تعذر الاتصال/);
assert.match(message({...expired,message:'Temporary password has expired'}),/انتهت صلاحية/);
assert.match(message({code:'invalid_credentials',status:400}),/البريد أو كلمة المرور/);
assert.match(message({code:'email_not_confirmed'}),/غير مؤكد/);
assert.match(message({code:'user_banned'}),/موقوف/);
assert.match(message({status:429}),/محاولات كثيرة/);
assert.match(message({code:'over_request_rate_limit'}),/محاولات كثيرة/);
assert.match(message({code:'request_timeout'}),/مهلة/);
for(const error of [{name:'AuthRetryableFetchError'},{status:0},{status:503}])assert.match(message(error),/تعذر الاتصال/);
for(const error of [{},{code:'unknown',status:403,message:'other hook error'},{status:400,message:'internal detail that must stay hidden'}]){
 assert.match(message(error),/تعذر إكمال تسجيل الدخول/);
 assert.doesNotMatch(message(error),/تعذر الاتصال|بياناتك لم|internal detail|انتهت صلاحية/);
}
console.log('PASS expired temporary-password hook, credentials, confirmation, suspension, throttling, timeout, transport and safe unknown-error classification');
