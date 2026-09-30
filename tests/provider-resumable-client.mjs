import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/uploads/provider-resumable-client.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function scenario({ empty = false, status = 200, fail = false, uploadStatus } = {}) {
  const events = [], calls = [], progress = [];
  const exports = {};
  vm.runInNewContext(code, {
    exports, File, FormData,
    require(name) {
      if (name === './provider-client') return { optimizeProviderDocument: async file => { events.push(`optimize:${file.name}`); return file; } };
      if (name === 'tus-js-client') return { Upload: class {
        constructor(file, options) { this.file = file; this.options = options; calls.push(options); }
        start() {
          events.push(`upload:${this.file.name}`);
          if (fail) return this.options.onError(Object.assign(new Error('signed-secret-url'), uploadStatus ? { originalResponse: { getStatus: () => uploadStatus } } : {}));
          this.options.onProgress(this.file.size / 2, this.file.size);
          this.options.onProgress(this.file.size, this.file.size);
          this.options.onSuccess();
        }
      }};
      throw Error(name);
    },
    fetch: async (url, options) => {
      assert.equal(url, '/api/public/join/provider/uploads');
      assert.equal(options.headers['Idempotency-Key'], 'key');
      assert.ok([...options.body.values()].every(value => typeof value === 'string'));
      assert.equal(options.body.get('policyAccepted'), 'true');
      assert.equal(options.body.get('revisionToken'), 'revision');
      const documents = JSON.parse(options.body.get('documents'));
      assert.equal(documents.length, empty ? 0 : 2);
      if (!empty) assert.ok(documents[0].size > 10 * 1024 * 1024);
      return { ok: status === 200, status, json: async () => ({
        uploadToken: 'batch', endpoint: 'https://storage.example/upload/resumable', bucket: 'join-applications',
        message: 'policy changed', files: documents.map(doc => ({ documentType: doc.documentType, path: `batch/${doc.name}`, token: 'signed-token' })),
      }) };
    },
  });
  const data = new FormData();
  data.set('policyAccepted', 'true');
  if (!empty) {
    data.set('document:a', new File([new Uint8Array(11 * 1024 * 1024)], 'a.pdf', { type: 'application/pdf' }));
    data.set('document:b', new File(['b'], 'b.pdf', { type: 'application/pdf' }));
  }
  const action = exports.uploadProviderDocuments(data, { idempotencyKey: 'key', revisionToken: 'revision', onProgress: p => progress.push(p) });
  if (status !== 200) {
    await assert.rejects(action, error => error instanceof exports.ProviderUploadError && error.status === status);
    assert.equal(calls.length, 0);
  } else if (fail) {
    await assert.rejects(action, error => {
      assert.ok(!error.message.includes('signed-secret'));
      assert.ok(!error.message.includes('signed-token'));
      assert.equal(error.message.includes('السعة الحالية لخدمة التخزين'), uploadStatus === 413);
      assert.equal(error.message.includes('اتصال الإنترنت'), uploadStatus !== 413);
      return true;
    });
    assert.equal(data.has('uploadToken'), false);
    assert.equal(data.has('document:a'), true);
  } else {
    await action;
    assert.equal(data.get('uploadToken'), 'batch');
    assert.ok([...data.values()].every(value => typeof value === 'string'));
    assert.equal(progress.at(-1), 100);
    if (!empty) assert.deepEqual(events, ['optimize:a.pdf', 'optimize:b.pdf', 'upload:a.pdf', 'upload:b.pdf']);
    for (const options of calls) {
      assert.equal(options.chunkSize, 6 * 1024 * 1024);
      assert.equal(options.storeFingerprintForResuming, false);
      assert.equal(options.headers['x-upsert'], 'false');
      assert.equal(options.headers['x-signature'], 'signed-token');
      assert.equal(options.metadata.bucketName, 'join-applications');
      assert.ok(options.retryDelays.length > 0 && options.retryDelays.length < 10);
    }
  }
}
(async () => {
  await scenario();
  await scenario({ empty: true });
  await scenario({ status: 409 });
  await scenario({ fail: true });
  await scenario({ fail: true, uploadStatus: 413 });
  console.log('PASS: provider large-file metadata-only upload, sequential optimization/TUS, empty revision, policy conflict, credential-safe failure and storage-capacity error');
})().catch(error => { console.error(error); process.exitCode = 1; });
