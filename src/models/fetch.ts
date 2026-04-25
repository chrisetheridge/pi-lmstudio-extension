import { consola } from "consola";
import { debugLog, log } from "../debug.js";
import type { LmStudioConfig, FetchLike } from "../types.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { parseOpenAiModelsPayload, parseNativeModelsPayload } from "./parse.js";

const NAMESPACE = "lmstudio";
const fetchLog = consola.withTag(NAMESPACE);

/** Fetch models using the OpenAI-compatible /v1/models endpoint. */
export async function fetchOpenAiModels(
  config: LmStudioConfig,
  fetchImpl: FetchLike = fetch,
): Promise<import("../types.js").LmStudioModelInfo[]> {
  const cleanUrl = config.baseUrl.replace(/\/+$/, "");
  fetchLog.debug(`fetching models from ${cleanUrl}/models (timeout: ${config.fetchTimeoutMs}ms)`);
  debugLog("openai fetch request", { url: `${cleanUrl}/models`, timeoutMs: config.fetchTimeoutMs, hasApiKey: !!config.apiKey });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);

  try {
    const start = performance.now();
    const response = await fetchImpl(`${cleanUrl}/models`, {
      method: "GET",
      signal: controller.signal,
    });
    const fetchMs = (performance.now() - start).toFixed(2);
    fetchLog.debug(`fetch response received in ${fetchMs}ms (status: ${response.status})`);
    debugLog("openai fetch response", { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()), ok: response.ok });

    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable>");
      debugLog("openai fetch error response", { status: response.status, body });
      throw new Error(`model fetch failed: ${response.status} ${response.statusText}`.trim());
    }

    const models = parseOpenAiModelsPayload(await response.json());
    debugLog(`found ${models.length} model${models.length === 1 ? "" : "s"} via OpenAI-compatible endpoint`);
    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      debugLog("openai fetch aborted", { timeoutMs: config.fetchTimeoutMs });
      throw new Error(`model fetch timed out after ${config.fetchTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch models using the native /api/v1/models endpoint. */
export async function fetchNativeModels(
  config: LmStudioConfig,
  fetchImpl: FetchLike = fetch,
): Promise<import("../types.js").LmStudioModelInfo[]> {
  const nativeUrl = config.nativeBaseUrl || deriveNativeBaseUrl(config.baseUrl);
  fetchLog.debug(`fetching models from ${nativeUrl} (timeout: ${config.fetchTimeoutMs}ms)`);
  debugLog("native fetch request", { url: nativeUrl, timeoutMs: config.fetchTimeoutMs, hasApiKey: !!config.apiKey });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);

  try {
    const start = performance.now();
    const response = await fetchImpl(nativeUrl, {
      method: "GET",
      signal: controller.signal,
    });
    const fetchMs = (performance.now() - start).toFixed(2);
    fetchLog.debug(`fetch response received in ${fetchMs}ms (status: ${response.status})`);
    debugLog("native fetch response", { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()), ok: response.ok });

    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable>");
      debugLog("native fetch error response", { status: response.status, body });
      throw new Error(`native model fetch failed: ${response.status} ${response.statusText}`.trim());
    }

    const models = parseNativeModelsPayload(await response.json());
    fetchLog.info(`found ${models.length} model${models.length === 1 ? "" : "s"} via native endpoint`);
    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      debugLog("native fetch aborted", { timeoutMs: config.fetchTimeoutMs });
      throw new Error(`native model fetch timed out after ${config.fetchTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function deriveNativeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    return normalized.slice(0, -3) + "/api/v1";
  }
  return normalized + "/api/v1";
}

/** Fetch model info using the configured metadata source with auto-fallback. */
export async function fetchLmStudioModelInfo(
  config: LmStudioConfig,
  fetchImpl: FetchLike = fetch,
): Promise<{ models: import("../types.js").LmStudioModelInfo[]; source: "openai" | "native" }> {
  debugLog("fetch model info", { modelMetadataSource: config.modelMetadataSource, baseUrl: config.baseUrl, nativeBaseUrl: config.nativeBaseUrl });

  if (config.modelMetadataSource === "native") {
    debugLog("using native metadata source (explicit)");
    const models = await fetchNativeModels(config, fetchImpl);
    return { models, source: "native" };
  }

  if (config.modelMetadataSource === "openai") {
    debugLog("using openai metadata source (explicit)");
    const models = await fetchOpenAiModels(config, fetchImpl);
    return { models, source: "openai" };
  }

  // Auto: try native first, fall back to OpenAI
  debugLog("auto mode: trying native first");
  try {
    const models = await fetchNativeModels(config, fetchImpl);
    debugLog("auto mode: native succeeded", { modelCount: models.length });
    return { models, source: "native" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    debugLog(`native model discovery failed (${msg}), falling back to OpenAI-compatible endpoint`);
    debugLog("auto mode: native failed, falling back to openai", { error: msg });
    const models = await fetchOpenAiModels(config, fetchImpl);
    return { models, source: "openai" };
  }
}

/** Fetch models using the legacy /models endpoint (returns string IDs only). */
export async function fetchLmStudioModels(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = DEFAULT_CONFIG.fetchTimeoutMs,
): Promise<string[]> {
  const { parseModelsPayload } = await import("./parse.js");
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  fetchLog.debug(`fetching models from ${cleanUrl}/models (timeout: ${timeoutMs}ms)`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const start = performance.now();
    const response = await fetchImpl(`${cleanUrl}/models`, {
      method: "GET",
      signal: controller.signal,
    });
    const fetchMs = (performance.now() - start).toFixed(2);
    fetchLog.debug(`fetch response received in ${fetchMs}ms (status: ${response.status})`);

    if (!response.ok) {
      throw new Error(`model fetch failed: ${response.status} ${response.statusText}`.trim());
    }

    const models = parseModelsPayload(await response.json());
    debugLog(`found ${models.length} model${models.length === 1 ? "" : "s"}`);
    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`model fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
