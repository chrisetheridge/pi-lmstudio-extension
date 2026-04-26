import { consola } from "consola";
import { debugLog, log } from "../debug.js";
import type {
  LmStudioConfig,
  FetchLike,
  LoadModelCommandArgs,
  LoadModelResult,
  UnloadModelResult,
} from "../types.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { parseOpenAiModelsPayload, parseNativeModelsPayload } from "./parse.js";
import { deriveNativeBaseUrl } from "../url.js";

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
  const nativeUrl = nativeModelsUrl(config.nativeBaseUrl || deriveNativeBaseUrl(config.baseUrl));
  const timeoutMs = config.modelManagementTimeoutMs ?? config.fetchTimeoutMs;
  fetchLog.debug(`fetching models from ${nativeUrl} (timeout: ${timeoutMs}ms)`);
  debugLog("native fetch request", { url: nativeUrl, timeoutMs, hasApiKey: !!config.apiKey });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
    // fetchLog.info(`found ${models.length} model${models.length === 1 ? "" : "s"} via native endpoint`);
    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      debugLog("native fetch aborted", { timeoutMs });
      throw new Error(`native model fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Build the native API base URL for a given config. */
function resolveNativeBaseUrl(config: LmStudioConfig): string {
  const raw = config.nativeBaseUrl || deriveNativeBaseUrl(config.baseUrl);
  return normalizeNativeBaseUrl(raw);
}

/** Build the full URL for loading a model. */
function loadModelUrl(nativeBaseUrl: string): string {
  const normalized = nativeBaseUrl.replace(/\/+$/, "");
  return `${normalized}/models/load`;
}

/** Build the full URL for unloading a model instance. */
function unloadModelUrl(nativeBaseUrl: string): string {
  const normalized = nativeBaseUrl.replace(/\/+$/, "");
  return `${normalized}/models/unload`;
}

/** Send an auth header if apiKey is set and non-empty. */
function buildHeaders(hasApiKey: boolean, extraHeaders?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = { ...extraHeaders };
  if (hasApiKey) {
    headers["Authorization"] = `Bearer lm`;
  }
  return headers;
}

/** Fetch models using the native /api/v1/models endpoint with a custom timeout. */
export async function fetchNativeModelsWithTimeout(
  baseUrl: string,
  timeoutMs: number,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<import("../types.js").LmStudioModelInfo[]> {
  const nativeUrl = nativeModelsUrl(normalizeNativeBaseUrl(baseUrl));
  fetchLog.debug(`fetching models from ${nativeUrl} (timeout: ${timeoutMs}ms)`);
  debugLog("native fetch request", { url: nativeUrl, timeoutMs, hasApiKey: !!apiKey });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const start = performance.now();
    const response = await fetchImpl(nativeUrl, {
      method: "GET",
      signal: controller.signal,
      headers: buildHeaders(apiKey !== ""),
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
    // fetchLog.info(`found ${models.length} model${models.length === 1 ? "" : "s"} via native endpoint`);
    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      debugLog("native fetch aborted", { timeoutMs });
      throw new Error(`native model fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Load a model using the native /api/v1/models/load endpoint. */
export async function loadLmStudioModel(
  config: LmStudioConfig,
  args: LoadModelCommandArgs,
  fetchImpl: FetchLike = fetch,
): Promise<LoadModelResult> {
  const baseUrl = resolveNativeBaseUrl(config);
  const url = loadModelUrl(baseUrl);
  const timeoutMs = config.modelManagementTimeoutMs;

  debugLog("load model request", { url, model: args.model, timeoutMs });

  const body: Record<string, unknown> = {
    model: args.model,
    echo_load_config: true,
  };

  if (args.contextLength !== undefined) body.context_length = args.contextLength;
  if (args.flashAttention !== undefined) body.flash_attention = args.flashAttention;
  if (args.evalBatchSize !== undefined) body.eval_batch_size = args.evalBatchSize;
  if (args.numExperts !== undefined) body.num_experts = args.numExperts;
  if (args.offloadKvCacheToGpu !== undefined) body.offload_kv_cache_to_gpu = args.offloadKvCacheToGpu;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const start = performance.now();
    const response = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: buildHeaders(config.apiKey !== "", { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const fetchMs = (performance.now() - start).toFixed(2);
    debugLog("load model response", { status: response.status, statusText: response.statusText, elapsedMs: fetchMs });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "<unreadable>");
      debugLog("load model error response", { status: response.status, body: bodyText });
      throw new Error(`model load failed: ${response.status} ${response.statusText}${bodyText ? ` (${bodyText})` : ""}`.trim());
    }

    const result = (await response.json()) as LoadModelResult;
    debugLog("load model success", { instanceId: result.instance_id, loadTimeSeconds: result.load_time_seconds });
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      debugLog("load model aborted", { timeoutMs });
      throw new Error(`model load timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Unload a model instance using the native /api/v1/models/unload endpoint. */
export async function unloadLmStudioModel(
  config: LmStudioConfig,
  instanceId: string,
  fetchImpl: FetchLike = fetch,
): Promise<UnloadModelResult> {
  const baseUrl = resolveNativeBaseUrl(config);
  const url = unloadModelUrl(baseUrl);
  const timeoutMs = config.modelManagementTimeoutMs;

  debugLog("unload model request", { url, instanceId, timeoutMs });

  const body = JSON.stringify({ instance_id: instanceId });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const start = performance.now();
    const response = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: buildHeaders(config.apiKey !== "", { "Content-Type": "application/json" }),
      body,
    });
    const fetchMs = (performance.now() - start).toFixed(2);
    debugLog("unload model response", { status: response.status, statusText: response.statusText, elapsedMs: fetchMs });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "<unreadable>");
      debugLog("unload model error response", { status: response.status, body: bodyText });
      throw new Error(`model unload failed: ${response.status} ${response.statusText}${bodyText ? ` (${bodyText})` : ""}`.trim());
    }

    const result = (await response.json()) as UnloadModelResult;
    debugLog("unload model success", { instanceId: result.instance_id });
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      debugLog("unload model aborted", { timeoutMs });
      throw new Error(`model unload timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeNativeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function nativeModelsUrl(nativeBaseUrl: string): string {
  const normalized = nativeBaseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/models") ? normalized : `${normalized}/models`;
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
