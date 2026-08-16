const DEFAULT_DEVICE_PREFERENCE = "auto";

export async function selectBrowserInferenceDevice({
  preference = DEFAULT_DEVICE_PREFERENCE,
  environment = globalThis,
} = {}) {
  const normalizedPreference = normalizeDevicePreference(preference);
  if (normalizedPreference === "wasm") {
    return createWasmSelection("WASM CPU was explicitly requested.");
  }

  if (!environment?.navigator?.gpu?.requestAdapter) {
    return createWasmSelection("WebGPU is not exposed by this browser.");
  }

  try {
    const adapter = await environment.navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      return createWasmSelection("The browser did not provide a WebGPU adapter.");
    }
    const adapterInfo = normalizeAdapterInfo(adapter.info);
    return {
      device: "webgpu",
      deviceLabel: formatWebGpuLabel(adapterInfo),
      adapterInfo,
      fallbackReason: "",
    };
  } catch (error) {
    return createWasmSelection(`WebGPU adapter request failed: ${error?.message || String(error)}`);
  }
}

export async function loadPipelineWithDeviceFallback({
  createPipeline,
  task,
  modelId,
  dtype = "q4",
  devicePreference = DEFAULT_DEVICE_PREFERENCE,
  environment = globalThis,
  pipelineOptions = {},
  onLifecycle = () => {},
} = {}) {
  if (typeof createPipeline !== "function") {
    throw new Error("Browser inference requires a pipeline factory.");
  }

  let runtime = await selectBrowserInferenceDevice({ preference: devicePreference, environment });
  onLifecycle(createRuntimeEvent(runtime));
  try {
    const instance = await createPipeline(task, modelId, {
      ...pipelineOptions,
      dtype,
      device: runtime.device,
    });
    return { pipeline: instance, runtime };
  } catch (webGpuError) {
    if (runtime.device !== "webgpu") throw webGpuError;

    runtime = createWasmSelection(`WebGPU pipeline initialization failed: ${webGpuError?.message || String(webGpuError)}`);
    onLifecycle(createRuntimeEvent(runtime));
    try {
      const instance = await createPipeline(task, modelId, {
        ...pipelineOptions,
        dtype,
        device: "wasm",
      });
      return { pipeline: instance, runtime };
    } catch (wasmError) {
      throw new Error(
        `${runtime.fallbackReason} WASM fallback also failed: ${wasmError?.message || String(wasmError)}`,
        { cause: wasmError },
      );
    }
  }
}

export function createRuntimeMetadata(runtime = {}) {
  return {
    executionDevice: runtime.device || "wasm",
    executionDeviceLabel: runtime.deviceLabel || "WASM CPU",
    ...(runtime.adapterInfo ? { webGpuAdapterInfo: runtime.adapterInfo } : {}),
    ...(runtime.fallbackReason ? { deviceFallbackReason: runtime.fallbackReason } : {}),
  };
}

function createRuntimeEvent(runtime) {
  const usingWebGpu = runtime.device === "webgpu";
  return {
    stage: "inference-runtime",
    progress: 1,
    device: runtime.device,
    deviceLabel: runtime.deviceLabel,
    ...(runtime.adapterInfo ? { adapterInfo: runtime.adapterInfo } : {}),
    ...(runtime.fallbackReason ? { fallbackReason: runtime.fallbackReason } : {}),
    message: usingWebGpu
      ? `Using ${runtime.deviceLabel} for browser inference.`
      : `${runtime.fallbackReason} Using WASM CPU for browser inference.`,
  };
}

function createWasmSelection(fallbackReason) {
  return {
    device: "wasm",
    deviceLabel: "WASM CPU",
    adapterInfo: null,
    fallbackReason,
  };
}

function normalizeAdapterInfo(info) {
  if (!info || typeof info !== "object") return {};
  return Object.fromEntries(
    ["vendor", "architecture", "device", "description"]
      .map((key) => [key, String(info[key] || "").trim()])
      .filter(([, value]) => value),
  );
}

function formatWebGpuLabel(info) {
  const vendor = formatVendor(info.vendor);
  const architecture = info.architecture ? formatWords(info.architecture) : "";
  const details = [vendor, architecture].filter(Boolean).join(" ");
  return details ? `WebGPU (${details})` : "WebGPU";
}

function formatVendor(vendor = "") {
  if (vendor.toLowerCase() === "nvidia") return "NVIDIA";
  if (vendor.toLowerCase() === "amd") return "AMD";
  if (vendor.toLowerCase() === "intel") return "Intel";
  return formatWords(vendor);
}

function formatWords(value = "") {
  return value.replace(/(^|[-_\s])([a-z])/g, (_, separator, letter) => `${separator === "-" || separator === "_" ? " " : separator}${letter.toUpperCase()}`);
}

function normalizeDevicePreference(preference) {
  const normalized = String(preference || DEFAULT_DEVICE_PREFERENCE).trim().toLowerCase();
  if (!["auto", "webgpu", "wasm"].includes(normalized)) {
    throw new Error(`Unsupported browser inference device preference: ${preference}.`);
  }
  return normalized;
}

export { DEFAULT_DEVICE_PREFERENCE };
