import { debugLog } from "./debug.js";

/** Derive the native API base URL from an OpenAI-compatible baseUrl. */
export function deriveNativeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  let result: string;
  // Replace trailing /v1 with /api/v1
  if (normalized.endsWith("/v1")) {
    result = normalized.slice(0, -3) + "/api/v1";
  } else {
    // If it doesn't end in /v1, just append /api/v1
    result = normalized + "/api/v1";
  }
  debugLog("derived native base URL", { from: baseUrl, to: result });
  return result;
}

/** Normalize the OpenAI-compatible API base URL used for model inference. */
export function normalizeOpenAiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

/** Normalize a nativeBaseUrl by stripping trailing slashes. */
export function normalizeNativeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
