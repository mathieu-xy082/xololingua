const LOCAL_SERVICE_URL = "http://127.0.0.1:8765";

export function resolveServiceBaseUrl(location = globalThis.location) {
  if (!location?.origin || ["localhost", "127.0.0.1"].includes(location.hostname)) {
    return LOCAL_SERVICE_URL;
  }
  return location.origin;
}
