import assert from "node:assert/strict";
import { File as BufferFile } from "node:buffer";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as pdfLib from "pdf-lib";

const FileClass = globalThis.File ?? BufferFile;
const { PDFDocument, PDFName, PDFHexString, PDFDict, PDFArray } = pdfLib;
const compile = async path => ts.transpileModule(
  (await readFile(new URL(path, import.meta.url), "utf8")).replaceAll("import.meta.url", JSON.stringify(import.meta.url)),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const coreSource = await compile("../src/lib/uploads/provider-optimize.ts");
const clientSource = await compile("../src/lib/uploads/provider-client.ts");
function core(environment = {}) {
  const exports = {};
  vm.runInNewContext(coreSource, {
    exports, require: name => { assert.equal(name, "pdf-lib"); return pdfLib; },
    File: FileClass, Uint8Array, TextDecoder, ...environment,
  });
  return exports.optimizeProviderDocumentInWorker;
}
const optimize = core();
let checks = 0;
async function check(name, run) {
  try { await run(); checks++; }
  catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
}
const file = (parts, name = "certificate.pdf", type = "application/pdf") => new FileClass(parts, name, { type, lastModified: 12345 });
async function makePdf(configure = () => {}, objectStreams = false) {
  const document = await PDFDocument.create();
  for (let index = 0; index < 5; index++) document.addPage([595, 842]).drawText(`Readable certificate page ${index + 1}`);
  document.setTitle("Provider certificate");
  await configure(document);
  return file([await document.save({ useObjectStreams: objectStreams, updateFieldAppearances: false })]);
}

await check("PDF object packing reduces size and preserves page contents, fonts and metadata", async () => {
  const original = await makePdf();
  const result = await optimize(original);
  assert(result.size < original.size);
  assert.equal(result.name, original.name);
  assert.equal(result.lastModified, original.lastModified);
  const before = await PDFDocument.load(await original.arrayBuffer());
  const after = await PDFDocument.load(await result.arrayBuffer());
  assert.equal(after.getTitle(), before.getTitle());
  assert.equal(after.getPageCount(), 5);
  for (let index = 0; index < 5; index++) {
    assert.deepEqual(after.getPage(index).getSize(), before.getPage(index).getSize());
    const streams = document => document.getPage(index).node.Contents().asArray()
      .map(ref => Buffer.from(document.context.lookup(ref).getContents()).toString("base64"));
    assert.deepEqual(streams(after), streams(before));
    assert.equal(after.getPage(index).node.Resources().toString(), before.getPage(index).node.Resources().toString());
  }
});
await check("AcroForm fields and existing values survive without regeneration", async () => {
  const original = await makePdf(document => {
    const field = document.getForm().createTextField("company");
    field.setText("Readable company name");
    field.addToPage(document.getPage(0));
  });
  const result = await optimize(original);
  const after = await PDFDocument.load(await result.arrayBuffer());
  assert.equal(after.getForm().getTextField("company").getText(), "Readable company name");
});
for (const objectStreams of [false, true]) {
  await check(`Signature dictionary remains byte-identical (compressed=${objectStreams})`, async () => {
    const original = await makePdf(document => {
      const signature = document.context.obj({ Type: "Sig", ByteRange: [0, 100, 200, 100], Contents: PDFHexString.of("012345") });
      document.catalog.set(PDFName.of("TestSignature"), document.context.register(signature));
    }, objectStreams);
    assert.equal(await optimize(original), original);
  });
}
await check("Nested signature/XFA entries preserve original", async () => {
  const original = await makePdf(document => {
    const nested = PDFDict.withContext(document.context);
    nested.set(PDFName.of("XFA"), PDFHexString.of("012345"));
    const array = PDFArray.withContext(document.context);
    array.push(nested);
    document.catalog.set(PDFName.of("TestNested"), array);
  }, true);
  assert.equal(await optimize(original), original);
});
await check("Encrypted, malformed, empty and unsupported files retain originals", async () => {
  for (const original of [file(["%PDF-1.7\n/Encrypt 1 0 R"]), file(["broken PDF"]), file([]), file(["abc"], "a.txt", "text/plain")]) {
    assert.equal(await optimize(original), original);
  }
});
await check("Large-file processing budget is not an upload rejection or memory read", async () => {
  const original = { type: "application/pdf", size: 64 * 1024 * 1024, arrayBuffer() { throw new Error("must not read"); } };
  assert.equal(await optimize(original), original);
});

function imageHarness({ width = 4800, height = 3200, size = 1000, mime = "image/webp", throws = false } = {}) {
  const state = { closed: 0, draw: null, dimensions: null, options: null };
  const optimizeImage = core({
    createImageBitmap: async (_file, options) => {
      assert.equal(options.imageOrientation, "from-image");
      return { width, height, close: () => state.closed++ };
    },
    OffscreenCanvas: class {
      constructor(w, h) { state.dimensions = [w, h]; }
      getContext() { return { drawImage: (...args) => { state.draw = args.slice(1); } }; }
      async convertToBlob(options) {
        state.options = options;
        if (throws) throw new Error("codec failed");
        return new Blob([new Uint8Array(size)], { type: mime });
      }
    },
  });
  return { optimizeImage, state };
}
const imageFile = file([new Uint8Array(256 * 1024)], "scan.png", "image/png");
await check("Image scales once to 2400px, orients, encodes .72 WebP and closes bitmap", async () => {
  const { optimizeImage, state } = imageHarness();
  const result = await optimizeImage(imageFile);
  assert.deepEqual(state.dimensions, [2400, 1600]);
  assert.deepEqual(state.draw, [0, 0, 2400, 1600]);
  assert.equal(state.options.quality, 0.72);
  assert.equal(result.type, "image/webp");
  assert.equal(result.name, "scan.webp");
  assert.equal(result.lastModified, imageFile.lastModified);
  assert.equal(state.closed, 1);
});
await check("Small scans retain dimensions and higher quality", async () => {
  const { optimizeImage, state } = imageHarness({ width: 1000, height: 1500 });
  await optimizeImage(imageFile);
  assert.deepEqual(state.dimensions, [1000, 1500]);
  assert.equal(state.options.quality, 0.8);
});
await check("Larger output, encoder MIME fallback, excessive pixels and codec failure retain original", async () => {
  for (const options of [{ size: imageFile.size + 1 }, { mime: "image/png" }, { width: 10000, height: 10000 }, { throws: true }]) {
    const { optimizeImage, state } = imageHarness(options);
    assert.equal(await optimizeImage(imageFile), imageFile);
    assert.equal(state.closed, 1);
  }
  assert.equal(await optimize(imageFile), imageFile);
});

function client(mode) {
  let terminated = 0;
  let created = 0;
  const exports = {};
  vm.runInNewContext(clientSource, {
    exports, File: FileClass, URL,
    setTimeout: callback => { if (mode === "timeout") queueMicrotask(callback); return 1; }, clearTimeout() {},
    ...(mode === "unsupported" ? {} : { Worker: class {
      constructor() { created++; if (mode === "constructor-error") throw new Error("CSP blocked"); }
      postMessage() {
        if (mode === "timeout") return;
        if (mode === "error") this.onerror();
        else if (mode === "message-error") this.onmessageerror();
        else this.onmessage({ data: mode === "smaller" ? file(["small"]) : file([new Uint8Array(300000)]) });
      }
      terminate() { terminated++; }
    } }),
  });
  return { optimize: exports.optimizeProviderDocument, terminated: () => terminated, created: () => created };
}
await check("Worker result accepted only when smaller; every worker is terminated", async () => {
  for (const mode of ["smaller", "larger", "error", "message-error", "timeout", "constructor-error", "unsupported"]) {
    const harness = client(mode);
    const result = await harness.optimize(imageFile);
    if (mode === "smaller") assert(result.size < imageFile.size);
    else assert.equal(result, imageFile);
    assert.equal(harness.terminated(), ["constructor-error", "unsupported"].includes(mode) ? 0 : 1);
  }
});
await check("Client skips oversized processing without starting worker", async () => {
  const harness = client("smaller");
  const large = { size: 64 * 1024 * 1024, type: "application/pdf" };
  assert.equal(await harness.optimize(large), large);
  assert.equal(harness.created(), 0);
});
console.log(`Provider document optimization: ${checks} focused groups passed (real PDF round trips, image/worker mocks).`);
