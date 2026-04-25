import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { debugLog } from "../debug.js";
import type { LmStudioConfig, LoadedConfig } from "../types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { mergeConfig } from "./merge.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    const input = value.input.filter((item): item is "text" | "image" => item === "text" || item === "image");
    if (input.length > 0) config.input = input;
  }
  if (typeof value.modelMetadataSource === "string" && (value.modelMetadataSource === "auto" || value.modelMetadataSource === "openai" || value.modelMetadataSource === "native")) {
    config.modelMetadataSource = value.modelMetadataSource;
  }
  if (typeof value.nativeBaseUrl === "string") config.nativeBaseUrl = value.nativeBaseUrl;
  if (typeof value.includeEmbeddingModels === "boolean") config.includeEmbeddingModels = value.includeEmbeddingModels;

  return config;
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
