import type { LmStudioConfig } from "../types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { deriveNativeBaseUrl, normalizeOpenAiBaseUrl, normalizeNativeBaseUrl } from "../url.js";

const MIN_REFRESH_INTERVAL_MS = 5000;

function positiveNumberOrDefault(value: number, defaultValue: number): number {
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

function clampRefreshIntervalMs(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.max(value, MIN_REFRESH_INTERVAL_MS);
  }
  return DEFAULT_CONFIG.refreshIntervalMs;
}

export function mergeConfig(
  globalConfig: Partial<LmStudioConfig> = {},
  projectConfig: Partial<LmStudioConfig> = {},
): LmStudioConfig {
  const merged = { ...DEFAULT_CONFIG, ...globalConfig, ...projectConfig };
  const baseUrl = normalizeOpenAiBaseUrl(merged.baseUrl);
  const hasConfiguredNativeBaseUrl =
    globalConfig.nativeBaseUrl !== undefined || projectConfig.nativeBaseUrl !== undefined;
  const nativeBaseUrl =
    hasConfiguredNativeBaseUrl && merged.nativeBaseUrl !== undefined
      ? normalizeNativeBaseUrl(merged.nativeBaseUrl)
      : deriveNativeBaseUrl(baseUrl);
  return {
    ...merged,
    baseUrl,
    contextWindow: positiveNumberOrDefault(merged.contextWindow, DEFAULT_CONFIG.contextWindow),
    maxTokens: positiveNumberOrDefault(merged.maxTokens, DEFAULT_CONFIG.maxTokens),
    fetchTimeoutMs: positiveNumberOrDefault(merged.fetchTimeoutMs, DEFAULT_CONFIG.fetchTimeoutMs),
    modelManagementTimeoutMs: positiveNumberOrDefault(
      merged.modelManagementTimeoutMs,
      DEFAULT_CONFIG.modelManagementTimeoutMs,
    ),
    input: merged.input.length > 0 ? merged.input : DEFAULT_CONFIG.input,
    modelMetadataSource:
      merged.modelMetadataSource === "auto" ||
      merged.modelMetadataSource === "openai" ||
      merged.modelMetadataSource === "native"
        ? merged.modelMetadataSource
        : DEFAULT_CONFIG.modelMetadataSource,
    nativeBaseUrl,
    includeEmbeddingModels: merged.includeEmbeddingModels ?? DEFAULT_CONFIG.includeEmbeddingModels,
    autoRefresh: merged.autoRefresh ?? DEFAULT_CONFIG.autoRefresh,
    refreshIntervalMs: clampRefreshIntervalMs(merged.refreshIntervalMs),
    notifyAutoRefreshChanges:
      merged.notifyAutoRefreshChanges ?? DEFAULT_CONFIG.notifyAutoRefreshChanges,
  };
}
