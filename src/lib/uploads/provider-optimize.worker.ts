import { optimizeProviderDocumentInWorker } from "./provider-optimize";

// An explicit scope type avoids adding conflicting DOM/webworker libraries to
// the application's TypeScript configuration.
const scope = self as unknown as {
  onmessage: (event: MessageEvent<File>) => void;
  postMessage: (file: File | null) => void;
};

scope.onmessage = async (event) => {
  try {
    const result = await optimizeProviderDocumentInWorker(event.data);
    scope.postMessage(result === event.data ? null : result);
  } catch {
    scope.postMessage(null);
  }
};
