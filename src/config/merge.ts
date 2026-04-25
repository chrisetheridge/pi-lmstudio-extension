import type { LmStudioConfig, MetadataSource } from "../types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { normalizeOpenAiBaseUrl, normalizeNativeBaseUrl } from "../url.js";

function positiveNumberOrDefault(value: number, defaultValue: number): number {
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
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

function deriveNativeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    return normalized.slice(0, -3) + "/api/v1";
  }
  return normalized + "/api/v1";
}
