export function createWorkerRequestSession({
  environment,
  workerUrl,
  defaultFailureMessage = "Browser worker failed.",
  closedMessage = "Browser worker session is closed.",
  busyMessage = "Browser worker is already processing a request.",
}) {
  if (!workerUrl || typeof environment?.Worker !== "function") return undefined;

  const worker = new environment.Worker(workerUrl, { type: "module" });
  let activeRequest;
  let closed = false;

  const clearActiveRequest = () => {
    if (activeRequest?.timeoutId) clearTimeout(activeRequest.timeoutId);
    activeRequest = undefined;
  };

  const close = (error) => {
    if (closed) return;
    closed = true;
    if (activeRequest) {
      const { reject } = activeRequest;
      clearActiveRequest();
      reject(error || new Error(closedMessage));
    }
    if (typeof worker.terminate === "function") worker.terminate();
  };

  worker.onerror = (event) => {
    const failureMessage = activeRequest?.failureMessage || defaultFailureMessage;
    close(new Error(event?.message || failureMessage));
  };
  worker.onmessage = (event) => {
    if (!activeRequest) return;
    const message = event?.data || {};
    if (message.type === "progress") {
      activeRequest.onProgress(message.event);
      return;
    }
    if (message.type === "error") {
      close(new Error(message.error || activeRequest.failureMessage || defaultFailureMessage));
      return;
    }
    if (message.type === activeRequest.resultType) {
      const { resolve } = activeRequest;
      clearActiveRequest();
      resolve(message.result || message.metadata || {});
    }
  };

  return {
    request({
      requestType,
      resultType,
      request,
      onProgress = () => {},
      timeoutMs,
      timeoutMessage,
      failureMessage,
    }) {
      if (closed) return Promise.reject(new Error(closedMessage));
      if (activeRequest) return Promise.reject(new Error(busyMessage));
      return new Promise((resolve, reject) => {
        activeRequest = { resultType, onProgress, failureMessage, resolve, reject, timeoutId: undefined };
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
          activeRequest.timeoutId = setTimeout(() => close(new Error(timeoutMessage)), timeoutMs);
        }
        try {
          worker.postMessage({ type: requestType, request });
        } catch (error) {
          close(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    close,
  };
}
