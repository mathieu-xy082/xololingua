export function createWorkerRequestSession({
  environment,
  workerUrl,
  defaultFailureMessage = "Browser worker failed.",
  closedMessage = "Browser worker session is closed.",
  busyMessage = "Browser worker is already processing a request.",
}) {
  if (!workerUrl || typeof environment?.Worker !== "function") return undefined;

  const worker = new environment.Worker(workerUrl, { type: "module" });
  const scheduleTimeout = typeof environment?.setTimeout === "function"
    ? environment.setTimeout.bind(environment)
    : globalThis.setTimeout.bind(globalThis);
  const cancelTimeout = typeof environment?.clearTimeout === "function"
    ? environment.clearTimeout.bind(environment)
    : globalThis.clearTimeout.bind(globalThis);
  let activeRequest;
  let closed = false;

  const clearActiveRequest = () => {
    if (activeRequest?.timeoutId !== undefined) cancelTimeout(activeRequest.timeoutId);
    activeRequest = undefined;
  };

  const refreshActiveTimeout = () => {
    if (!activeRequest) return;
    if (activeRequest.timeoutId !== undefined) cancelTimeout(activeRequest.timeoutId);
    activeRequest.timeoutId = undefined;
    if (!Number.isFinite(activeRequest.timeoutMs) || activeRequest.timeoutMs <= 0) return;
    activeRequest.timeoutId = scheduleTimeout(
      () => close(new Error(activeRequest?.timeoutMessage || defaultFailureMessage)),
      activeRequest.timeoutMs,
    );
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
      refreshActiveTimeout();
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
        activeRequest = {
          resultType,
          onProgress,
          failureMessage,
          resolve,
          reject,
          timeoutId: undefined,
          timeoutMs,
          timeoutMessage,
        };
        refreshActiveTimeout();
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
