import { BROWSER_MAX_MEDIA_DURATION_SECONDS } from "./browser_resource_limits.js";

export const DEVELOPMENT_MAX_VIDEO_DURATION_SECONDS = 2.5 * 60 * 60;

export function resolveVideoDurationPolicy(location = globalThis.location) {
  const hostname = location?.hostname?.toLowerCase();
  const localDevelopment = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
  return localDevelopment
    ? { maxDurationSeconds: DEVELOPMENT_MAX_VIDEO_DURATION_SECONDS, label: "2 h 30 min" }
    : { maxDurationSeconds: BROWSER_MAX_MEDIA_DURATION_SECONDS, label: "1 h" };
}
