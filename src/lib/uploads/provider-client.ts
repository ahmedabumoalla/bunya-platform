// Optimization is optional: unsupported devices and expensive documents upload
// the original. These processing budgets are never attachment upload limits.
const MAX_OPTIMIZATION_BYTES = 32 * 1024 * 1024;
const OPTIMIZATION_TIMEOUT_MS = 20_000;
const OPTIMIZABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function optimizeProviderDocument(file: File): Promise<File> {
  if (!file.size || file.size > MAX_OPTIMIZATION_BYTES || !OPTIMIZABLE_TYPES.has(file.type)
    || typeof Worker === "undefined") return file;

  return new Promise((resolve) => {
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (candidate?: File) => {
      if (timeout) clearTimeout(timeout);
      worker?.terminate();
      resolve(candidate instanceof File && candidate.size > 0 && candidate.size < file.size ? candidate : file);
    };
    try {
      worker = new Worker(new URL("./provider-optimize.worker.ts", import.meta.url), { type: "module" });
      timeout = setTimeout(() => finish(), OPTIMIZATION_TIMEOUT_MS);
      worker.onmessage = (event: MessageEvent<File | null>) => finish(event.data ?? undefined);
      worker.onerror = () => finish();
      worker.onmessageerror = () => finish();
      worker.postMessage(file);
    } catch {
      finish();
    }
  });
}
