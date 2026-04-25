import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ProviderConfig } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

import { consola } from "consola";

const NAMESPACE = "lmstudio";

/** Tagged consola instance for the LM Studio extension */
const log = consola.withTag(NAMESPACE);

/** Whether debug mode is enabled (via CLI flag or env) */
let debugEnabled = false;

/** Debug-only logging helper — logs detailed metadata when debug mode is active */
export function debugLog(label: string, data?: unknown): void {
  if (!debugEnabled) return;
  log.debug(label, data);
}

/** Check if debug mode is active */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

function configureDebugLogging(flagValue: boolean | string | undefined): void {
  const debugFromFlag = flagValue === true;
  const debugFromEnv = process.env.PI_LMSTUDIO_DEBUG === "1" || process.env.PI_LMSTUDIO_DEBUG === "true";
  debugEnabled = debugFromFlag || debugFromEnv;
  if (debugEnabled) {
    log.info("LM Studio debug mode enabled");
  }
}

/** Wrap an async operation and log timing */
function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  log.debug(`▶ ${label}`);
  return fn()
    .then((result) => {
      const ms = performance.now() - start;
      log.debug(`✓ ${label} completed in ${ms.toFixed(2)}ms`);
      return result;
    })
    .catch((err) => {
      const ms = performance.now() - start;
      log.error(`✗ ${label} failed after ${ms.toFixed(2)}ms: ${err instanceof Error ? err.message : err}`);
      throw err;
    });
}

type ModelInput = "text" | "image";

export interface LmStudioModelInfo {
  id: string;
  name: string;
  type: "llm" | "embedding" | "unknown";
  input: ModelInput[];
  reasoning?: boolean;
  toolUse?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  loaded: boolean;
  loadedInstanceIds: string[];
  source: "openai" | "native";
}

export type MetadataSource = "auto" | "openai" | "native";

export interface LmStudioConfig {
  baseUrl: string;
  apiKey: string;
  providerName: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: ModelInput[];
  fetchTimeoutMs: number;
  modelMetadataSource: MetadataSource;
  nativeBaseUrl?: string;
  includeEmbeddingModels: boolean;
}

export interface LoadedConfig {
  config: LmStudioConfig;
  warnings: string[];
  lastDiscoverySource?: "openai" | "native" | undefined;
}

export type RefreshResult =
  | { ok: true; count: number; models: string[]; source: "openai" | "native" }
  | { ok: false; error: string };

type FetchLike = typeof fetch;

interface RefreshProviderApi {
  registerProvider(name: string, config: ProviderConfig): void;
  unregisterProvider?(name: string): void;
}

export const DEFAULT_CONFIG: LmStudioConfig = {
  baseUrl: "http://localhost:1234/v1",
  // LM Studio default — no auth required by default
  apiKey: "lmstudio",
  providerName: "local",
  contextWindow: 128000,
  maxTokens: 16384,
  reasoning: false,
  input: ["text"],
  fetchTimeoutMs: 2500,
  modelMetadataSource: "auto",
  nativeBaseUrl: "http://localhost:1234/api/v1",
  includeEmbeddingModels: false,
};

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const LOCAL_OPENAI_COMPAT = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsStrictMode: false,
  maxTokensField: "max_tokens" as const,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
function normalizeNativeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function readLmStudioSettings(path: string): { value?: Partial<LmStudioConfig>; warning?: string } {
  if (!existsSync(path)) {
    debugLog("settings file not found", path);
    return {};
  }

  try {
    const raw = readFileSync(path, "utf-8");
    debugLog("settings file contents", { path, contentLength: raw.length });
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.lmstudio)) {
      debugLog("no lmstudio key found", { path });
      return {};
    }
    const coerced = coercePartialConfig(parsed.lmstudio);
    debugLog("coerced lmstudio config", { path, config: coerced });
    return { value: coerced };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { warning: `Could not parse ${path}: ${message}` };
  }
}

function coercePartialConfig(value: Record<string, unknown>): Partial<LmStudioConfig> {
  const config: Partial<LmStudioConfig> = {};

  if (typeof value.baseUrl === "string") config.baseUrl = value.baseUrl;
  if (typeof value.apiKey === "string") config.apiKey = value.apiKey;
  if (typeof value.providerName === "string") config.providerName = value.providerName;
  if (typeof value.contextWindow === "number") config.contextWindow = value.contextWindow;
  if (typeof value.maxTokens === "number") config.maxTokens = value.maxTokens;
  if (typeof value.reasoning === "boolean") config.reasoning = value.reasoning;
  if (typeof value.fetchTimeoutMs === "number") config.fetchTimeoutMs = value.fetchTimeoutMs;
  if (Array.isArray(value.input)) {
    const input = value.input.filter((item): item is ModelInput => item === "text" || item === "image");
    if (input.length > 0) config.input = input;
  }
  if (typeof value.modelMetadataSource === "string" && (value.modelMetadataSource === "auto" || value.modelMetadataSource === "openai" || value.modelMetadataSource === "native")) {
    config.modelMetadataSource = value.modelMetadataSource;
  }
  if (typeof value.nativeBaseUrl === "string") config.nativeBaseUrl = value.nativeBaseUrl;
  if (typeof value.includeEmbeddingModels === "boolean") config.includeEmbeddingModels = value.includeEmbeddingModels;

  return config;
}

export function mergeConfig(
  globalConfig: Partial<LmStudioConfig> = {},
  projectConfig: Partial<LmStudioConfig> = {},
): LmStudioConfig {
  const merged = { ...DEFAULT_CONFIG, ...globalConfig, ...projectConfig };
  const baseUrl = normalizeOpenAiBaseUrl(merged.baseUrl);
  const hasConfiguredNativeBaseUrl = globalConfig.nativeBaseUrl !== undefined || projectConfig.nativeBaseUrl !== undefined;
  const nativeBaseUrl = hasConfiguredNativeBaseUrl && merged.nativeBaseUrl !== undefined
    ? normalizeNativeBaseUrl(merged.nativeBaseUrl)
    : deriveNativeBaseUrl(baseUrl);
  return {
    ...merged,
    baseUrl,
    contextWindow: positiveNumberOrDefault(merged.contextWindow, DEFAULT_CONFIG.contextWindow),
    maxTokens: positiveNumberOrDefault(merged.maxTokens, DEFAULT_CONFIG.maxTokens),
    fetchTimeoutMs: positiveNumberOrDefault(merged.fetchTimeoutMs, DEFAULT_CONFIG.fetchTimeoutMs),
    input: merged.input.length > 0 ? merged.input : DEFAULT_CONFIG.input,
    modelMetadataSource: (merged.modelMetadataSource === "auto" || merged.modelMetadataSource === "openai" || merged.modelMetadataSource === "native")
      ? merged.modelMetadataSource
      : DEFAULT_CONFIG.modelMetadataSource,
    nativeBaseUrl,
    includeEmbeddingModels: merged.includeEmbeddingModels ?? DEFAULT_CONFIG.includeEmbeddingModels,
  };
}

export function loadConfigFromSettings(cwd = process.cwd(), agentDir = getAgentDir()): LoadedConfig {
  const globalSettings = readLmStudioSettings(join(agentDir, "settings.json"));
  const projectSettings = readLmStudioSettings(join(cwd, ".pi", "settings.json"));
  const warnings = [globalSettings.warning, projectSettings.warning].filter((warning): warning is string => !!warning);

  return {
    config: mergeConfig(globalSettings.value, projectSettings.value),
    warnings,
    lastDiscoverySource: undefined,
  };
}

export function parseModelsPayload(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Expected LM Studio /models response with a data array");
  }

  return payload.data
    .map((entry) => (isRecord(entry) && typeof entry.id === "string" ? entry.id.trim() : ""))
    .filter((id) => id.length > 0);
}

/** Extract capabilities from an OpenAI-compatible model entry. */
function extractCapabilities(entry: Record<string, unknown>): { vision: boolean; toolUse: boolean } {
  const capabilities = entry.capabilities;
  let vision = false;
  let toolUse = false;

  if (Array.isArray(capabilities)) {
    for (const cap of capabilities) {
      if (typeof cap === "string") {
        if (cap === "vision" || cap === "image_input") vision = true;
        if (cap === "tool_use") toolUse = true;
      }
    }
  } else if (isRecord(capabilities)) {
    if (typeof capabilities.vision === "boolean") vision = capabilities.vision;
    if (typeof capabilities.image_input === "boolean") vision = vision || capabilities.image_input;
    if (typeof capabilities.tool_use === "boolean") toolUse = capabilities.tool_use;
  }

  return { vision, toolUse };
}

/** Parse an OpenAI-compatible /v1/models response into model info descriptors. */
export function parseOpenAiModelsPayload(payload: unknown): LmStudioModelInfo[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Expected LM Studio /v1/models response with a data array");
  }

  debugLog("openai models payload", { dataLength: payload.data.length, rawPayload: payload });

  const results: LmStudioModelInfo[] = [];

  for (const entry of payload.data) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) continue;

    const { vision, toolUse } = extractCapabilities(entry);

    results.push({
      id,
      name: id,
      type: "llm",
      input: vision ? ["text", "image"] : ["text"],
      toolUse: toolUse || undefined,
      loaded: false,
      loadedInstanceIds: [],
      source: "openai",
    });
  }

  debugLog("parsed openai models", results);
  return results;
}

/** Parse a native /api/v1/models response into model info descriptors. */
export function parseNativeModelsPayload(payload: unknown): LmStudioModelInfo[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Expected native /api/v1/models response with a data array");
  }

  debugLog("native models payload", { dataLength: payload.data.length, rawPayload: payload });

  const results: LmStudioModelInfo[] = [];

  for (const entry of payload.data) {
    if (!isRecord(entry)) continue;

    const type = entry.type;
    const modelType = type === "llm" || type === "embedding" ? type : "unknown";

    // Skip embedding models unless explicitly requested
    if (modelType === "embedding") {
      debugLog("skipping embedding model", { id: (entry as Record<string, unknown>).key });
      continue;
    }

    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    const displayName = typeof entry.display_name === "string" ? entry.display_name.trim() : "";
    const id = key || "";
    if (!id) continue;

    const capabilities = isRecord(entry.capabilities) ? entry.capabilities : undefined;
    const vision = capabilities && typeof capabilities.vision === "boolean" ? capabilities.vision : false;
    const toolUse = capabilities && typeof capabilities.trained_for_tool_use === "boolean" ? capabilities.trained_for_tool_use : false;

    // Determine context length from loaded instances first, then max_context_length
    let contextWindow: number | undefined;
    const loadedInstances = Array.isArray(entry.loaded_instances) ? entry.loaded_instances : [];
    const loadedInstanceIds: string[] = [];

    for (const inst of loadedInstances) {
      if (!isRecord(inst)) continue;
      const instId = typeof inst.id === "string" ? inst.id : undefined;
      if (instId) loadedInstanceIds.push(instId);
      const instCtx = typeof inst.context_length === "number" ? inst.context_length : undefined;
      if (instCtx !== undefined && contextWindow === undefined) {
        contextWindow = instCtx;
      }
    }

    const maxCtxLength = typeof entry.max_context_length === "number" ? entry.max_context_length : undefined;

    results.push({
      id,
      name: displayName || id,
      type: modelType,
      input: vision ? ["text", "image"] : ["text"],
      toolUse: toolUse || undefined,
      contextWindow: contextWindow ?? maxCtxLength,
      loaded: loadedInstances.length > 0,
      loadedInstanceIds,
      source: "native",
    });
  }

  debugLog("parsed native models", results);
  return results;
}

export async function fetchLmStudioModels(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = DEFAULT_CONFIG.fetchTimeoutMs,
): Promise<string[]> {
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  log.debug(`fetching models from ${cleanUrl}/models (timeout: ${timeoutMs}ms)`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const start = performance.now();
    const response = await fetchImpl(`${cleanUrl}/models`, {
      method: "GET",
      signal: controller.signal,
    });
    const fetchMs = (performance.now() - start).toFixed(2);
    log.debug(`fetch response received in ${fetchMs}ms (status: ${response.status})`);

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

/** Fetch models using the OpenAI-compatible /v1/models endpoint. */
export async function fetchOpenAiModels(
  config: LmStudioConfig,
  fetchImpl: FetchLike = fetch,
): Promise<LmStudioModelInfo[]> {
  const cleanUrl = config.baseUrl.replace(/\/+$/, "");
  log.debug(`fetching models from ${cleanUrl}/models (timeout: ${config.fetchTimeoutMs}ms)`);
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
    log.debug(`fetch response received in ${fetchMs}ms (status: ${response.status})`);
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
): Promise<LmStudioModelInfo[]> {
  const nativeUrl = config.nativeBaseUrl || deriveNativeBaseUrl(config.baseUrl);
  log.debug(`fetching models from ${nativeUrl} (timeout: ${config.fetchTimeoutMs}ms)`);
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
    log.debug(`fetch response received in ${fetchMs}ms (status: ${response.status})`);
    debugLog("native fetch response", { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()), ok: response.ok });

    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable>");
      debugLog("native fetch error response", { status: response.status, body });
      throw new Error(`native model fetch failed: ${response.status} ${response.statusText}`.trim());
    }

    const models = parseNativeModelsPayload(await response.json());
    log.info(`found ${models.length} model${models.length === 1 ? "" : "s"} via native endpoint`);
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

/** Fetch model info using the configured metadata source with auto-fallback. */
export async function fetchLmStudioModelInfo(
  config: LmStudioConfig,
  fetchImpl: FetchLike = fetch,
): Promise<{ models: LmStudioModelInfo[]; source: "openai" | "native" }> {
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

export function buildProviderConfig(config: LmStudioConfig, models: LmStudioModelInfo[]): ProviderConfig {
  const providerModels = models.map((model) => ({
    id: model.id,
    name: model.name,
    api: "openai-completions" as const,
    reasoning: model.reasoning ?? config.reasoning,
    input: model.input,
    cost: { ...ZERO_COST },
    contextWindow: model.contextWindow ?? config.contextWindow,
    maxTokens: model.maxTokens ?? config.maxTokens,
    compat: { ...LOCAL_OPENAI_COMPAT },
  }));

  debugLog("built provider config", {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    api: "openai-completions",
    modelCount: providerModels.length,
    models: providerModels,
  });

  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    api: "openai-completions",
    models: providerModels,
  };
}

export async function refreshProvider(
  pi: RefreshProviderApi,
  config: LmStudioConfig,
  fetchModelInfo: (config: LmStudioConfig) => Promise<{ models: LmStudioModelInfo[]; source: "openai" | "native" }> = async (currentConfig) =>
    fetchLmStudioModelInfo(currentConfig, fetch),
): Promise<RefreshResult> {
  const start = performance.now();
  debugLog(`refreshing provider '${config.providerName}' at ${config.baseUrl}`);
  debugLog("refresh start", { providerName: config.providerName, baseUrl: config.baseUrl, fetchTimeoutMs: config.fetchTimeoutMs });

  try {
    const { models, source } = await fetchModelInfo(config);
    debugLog("refresh result", { modelCount: models.length, source, modelIds: models.map((m) => m.id) });
    if (models.length === 0) {
      log.warn(`no models found, unregistering provider '${config.providerName}'`);
      pi.unregisterProvider?.(config.providerName);
    } else {
      const providerConfig = buildProviderConfig(config, models);
      pi.registerProvider(config.providerName, providerConfig);
      const ms = (performance.now() - start).toFixed(2);
      log.info(`provider '${config.providerName}' registered with ${models.length} model${models.length === 1 ? "" : "s"} in ${ms}ms (source: ${source})`);
    }

    return { ok: true, count: models.length, models: models.map((m) => m.id), source };
  } catch (error) {
    const ms = (performance.now() - start).toFixed(2);
    const msg = error instanceof Error ? error.message : String(error);
    debugLog("refresh error", { providerName: config.providerName, error: msg, elapsedMs: ms });
    log.error(`refresh failed for '${config.providerName}' after ${ms}ms: ${msg}`);
    return { ok: false, error: msg };
  }
}

export default async function lmStudioExtension(pi: ExtensionAPI) {
  let lastResult: RefreshResult | undefined;
  let lastWarnings: string[] = [];
  let lastDiscoverySource: "openai" | "native" | undefined;

  // Register the debug flag
  pi.registerFlag("lmstudio-debug", {
    description: "Enable verbose debug logging for LM Studio extension flows",
    type: "boolean",
    default: false,
  });

  async function refresh(cwd = process.cwd()): Promise<RefreshResult> {
    log.debug(`refreshing from cwd: ${cwd}`);
    const loaded = loadConfigFromSettings(cwd);
    lastWarnings = loaded.warnings;
    if (loaded.warnings.length > 0) {
      log.debug(`config warnings: ${loaded.warnings.join(", ")}`);
    }
    log.debug(`effective config: baseUrl=${loaded.config.baseUrl}, provider=${loaded.config.providerName}, contextWindow=${loaded.config.contextWindow}, maxTokens=${loaded.config.maxTokens}`);
    debugLog("effective config after merge", {
      baseUrl: loaded.config.baseUrl,
      apiKey: loaded.config.apiKey,
      providerName: loaded.config.providerName,
      contextWindow: loaded.config.contextWindow,
      maxTokens: loaded.config.maxTokens,
      fetchTimeoutMs: loaded.config.fetchTimeoutMs,
      modelMetadataSource: loaded.config.modelMetadataSource,
      nativeBaseUrl: loaded.config.nativeBaseUrl,
      includeEmbeddingModels: loaded.config.includeEmbeddingModels,
    });
    lastResult = await refreshProvider(pi, loaded.config);
    if (lastResult.ok) {
      lastDiscoverySource = lastResult.source;
    }
    return lastResult;
  }

  pi.on("session_start", async (_event, ctx) => {
    configureDebugLogging(pi.getFlag("lmstudio-debug"));
    lastResult = await refresh(ctx.cwd);
    if (lastResult.ok) {
      log.info(`registered ${lastResult.count} local model${lastResult.count === 1 ? "" : "s"}`);
      debugLog("registered models", lastResult.models);
    } else {
      log.error(`initial refresh failed: ${lastResult.error}`);
    }
    for (const warning of lastWarnings) {
      log.warn(warning);
    }
  });

  pi.registerCommand("lmstudio-refresh", {
    description: "Refresh LM Studio local models",
    handler: async (_args, ctx) => {
      log.info("refresh command invoked");
      const result = await refresh(ctx.cwd);
      for (const warning of lastWarnings) {
        ctx.ui.notify(`[lmstudio] ${warning}`, "warning");
      }
      if (result.ok) {
        const sourceHint = result.source !== "openai" ? ` (using ${result.source} metadata)` : "";
        ctx.ui.notify(`[lmstudio] registered ${result.count} local model${result.count === 1 ? "" : "s"}${sourceHint}`, "info");
      } else {
        ctx.ui.notify(`[lmstudio] refresh failed: ${result.error}`, "warning");
      }
    },
  });

  pi.registerCommand("lmstudio-status", {
    description: "Show LM Studio provider status",
    handler: async (_args, ctx) => {
      log.info("status command invoked");
      const { config, warnings } = loadConfigFromSettings(ctx.cwd);
      for (const warning of warnings) {
        ctx.ui.notify(`[lmstudio] ${warning}`, "warning");
      }
      const status =
        lastResult === undefined
          ? "not refreshed yet"
          : lastResult.ok
            ? `${lastResult.count} local model${lastResult.count === 1 ? "" : "s"} registered${lastDiscoverySource ? ` (metadata: ${lastDiscoverySource})` : ""}`
            : `last refresh failed: ${lastResult.error}`;
      ctx.ui.notify(`[lmstudio] ${config.baseUrl} (${config.providerName}/): ${status}`, lastResult?.ok === false ? "warning" : "info");
    },
  });
}

function positiveNumberOrDefault(value: number, defaultValue: number): number {
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}
