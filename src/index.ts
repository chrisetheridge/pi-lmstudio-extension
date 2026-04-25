import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ProviderConfig } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

const NAMESPACE = "lmstudio";

/** Format a timestamp as [HH:MM:SS.mmm] */
function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `[${h}:${m}:${s}.${ms}]`;
}

/** Log levels */
const LOG_LEVEL = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
let currentLogLevel: (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL] = LOG_LEVEL.INFO;

/** Set log level from environment or default to INFO */
const envLevel = process.env.PI_LMSTUDIO_LOG;
if (envLevel) {
  const parsed = LOG_LEVEL[envLevel.toUpperCase() as keyof typeof LOG_LEVEL];
  if (parsed !== undefined) currentLogLevel = parsed;
}

/** Internal logger helper */
function _log(level: (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL], message: string, ...args: unknown[]): void {
  if (level < currentLogLevel) return;
  const prefix = `${timestamp()} [${NAMESPACE}]`;
  switch (level) {
    case LOG_LEVEL.DEBUG:
      console.debug(`${prefix} DEBUG`, message, ...args);
      break;
    case LOG_LEVEL.INFO:
      console.log(`${prefix} INFO`, message, ...args);
      break;
    case LOG_LEVEL.WARN:
      console.warn(`${prefix} WARN`, message, ...args);
      break;
    case LOG_LEVEL.ERROR:
      console.error(`${prefix} ERROR`, message, ...args);
      break;
  }
}

export const log = {
  debug: (message: string, ...args: unknown[]) => _log(LOG_LEVEL.DEBUG, message, ...args),
  info: (message: string, ...args: unknown[]) => _log(LOG_LEVEL.INFO, message, ...args),
  warn: (message: string, ...args: unknown[]) => _log(LOG_LEVEL.WARN, message, ...args),
  error: (message: string, ...args: unknown[]) => _log(LOG_LEVEL.ERROR, message, ...args),
};

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

export interface LmStudioConfig {
  baseUrl: string;
  apiKey: string;
  providerName: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: ModelInput[];
  fetchTimeoutMs: number;
}

export interface LoadedConfig {
  config: LmStudioConfig;
  warnings: string[];
}

export type RefreshResult =
  | { ok: true; count: number; models: string[] }
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

function readLmStudioSettings(path: string): { value?: Partial<LmStudioConfig>; warning?: string } {
  if (!existsSync(path)) return {};

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.lmstudio)) return {};
    return { value: coercePartialConfig(parsed.lmstudio) };
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

  return config;
}

export function mergeConfig(
  globalConfig: Partial<LmStudioConfig> = {},
  projectConfig: Partial<LmStudioConfig> = {},
): LmStudioConfig {
  const merged = { ...DEFAULT_CONFIG, ...globalConfig, ...projectConfig };
  return {
    ...merged,
    baseUrl: merged.baseUrl.replace(/\/+$/, ""),
    contextWindow: positiveNumberOrDefault(merged.contextWindow, DEFAULT_CONFIG.contextWindow),
    maxTokens: positiveNumberOrDefault(merged.maxTokens, DEFAULT_CONFIG.maxTokens),
    fetchTimeoutMs: positiveNumberOrDefault(merged.fetchTimeoutMs, DEFAULT_CONFIG.fetchTimeoutMs),
    input: merged.input.length > 0 ? merged.input : DEFAULT_CONFIG.input,
  };
}

export function loadConfigFromSettings(cwd = process.cwd(), agentDir = getAgentDir()): LoadedConfig {
  const globalSettings = readLmStudioSettings(join(agentDir, "settings.json"));
  const projectSettings = readLmStudioSettings(join(cwd, ".pi", "settings.json"));
  const warnings = [globalSettings.warning, projectSettings.warning].filter((warning): warning is string => !!warning);

  return {
    config: mergeConfig(globalSettings.value, projectSettings.value),
    warnings,
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
    log.info(`found ${models.length} model${models.length === 1 ? "" : "s"}`);
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

export function buildProviderConfig(config: LmStudioConfig, modelIds: string[]): ProviderConfig {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    api: "openai-completions",
    models: modelIds.map((id) => ({
      id,
      name: id,
      api: "openai-completions",
      reasoning: config.reasoning,
      input: config.input,
      cost: { ...ZERO_COST },
      contextWindow: config.contextWindow,
      maxTokens: config.maxTokens,
      compat: { ...LOCAL_OPENAI_COMPAT },
    })),
  };
}

export async function refreshProvider(
  pi: RefreshProviderApi,
  config: LmStudioConfig,
  fetchModels: (config: LmStudioConfig) => Promise<string[]> = (currentConfig) =>
    fetchLmStudioModels(currentConfig.baseUrl, fetch, currentConfig.fetchTimeoutMs),
): Promise<RefreshResult> {
  const start = performance.now();
  log.info(`refreshing provider '${config.providerName}' at ${config.baseUrl}`);

  try {
    const models = await fetchModels(config);
    if (models.length === 0) {
      log.warn(`no models found, unregistering provider '${config.providerName}'`);
      pi.unregisterProvider?.(config.providerName);
    } else {
      pi.registerProvider(config.providerName, buildProviderConfig(config, models));
      const ms = (performance.now() - start).toFixed(2);
      log.info(`provider '${config.providerName}' registered with ${models.length} model${models.length === 1 ? "" : "s"} in ${ms}ms`);
    }

    return { ok: true, count: models.length, models };
  } catch (error) {
    const ms = (performance.now() - start).toFixed(2);
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`refresh failed for '${config.providerName}' after ${ms}ms: ${msg}`);
    return { ok: false, error: msg };
  }
}

export default async function lmStudioExtension(pi: ExtensionAPI) {
  let lastResult: RefreshResult | undefined;
  let lastWarnings: string[] = [];

  async function refresh(cwd = process.cwd()): Promise<RefreshResult> {
    log.debug(`refreshing from cwd: ${cwd}`);
    const loaded = loadConfigFromSettings(cwd);
    lastWarnings = loaded.warnings;
    if (loaded.warnings.length > 0) {
      log.debug(`config warnings: ${loaded.warnings.join(", ")}`);
    }
    log.debug(`effective config: baseUrl=${loaded.config.baseUrl}, provider=${loaded.config.providerName}, contextWindow=${loaded.config.contextWindow}, maxTokens=${loaded.config.maxTokens}`);
    lastResult = await refreshProvider(pi, loaded.config);
    return lastResult;
  }

  lastResult = await refresh();
  if (lastResult.ok) {
    log.info(`registered ${lastResult.count} local model${lastResult.count === 1 ? "" : "s"}`);
  } else {
    log.error(`initial refresh failed: ${lastResult.error}`);
  }
  for (const warning of lastWarnings) {
    log.warn(warning);
  }

  pi.registerCommand("lmstudio-refresh", {
    description: "Refresh LM Studio local models",
    handler: async (_args, ctx) => {
      log.info("refresh command invoked");
      const result = await refresh(ctx.cwd);
      for (const warning of lastWarnings) {
        ctx.ui.notify(`[lmstudio] ${warning}`, "warning");
      }
      if (result.ok) {
        ctx.ui.notify(`[lmstudio] registered ${result.count} local model${result.count === 1 ? "" : "s"}`, "info");
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
            ? `${lastResult.count} local model${lastResult.count === 1 ? "" : "s"} registered`
            : `last refresh failed: ${lastResult.error}`;
      ctx.ui.notify(`[lmstudio] ${config.baseUrl} (${config.providerName}/): ${status}`, lastResult?.ok === false ? "warning" : "info");
    },
  });
}

function positiveNumberOrDefault(value: number, defaultValue: number): number {
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}
