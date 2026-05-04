import type { ProviderConfig } from "@mariozechner/pi-coding-agent";
import { debugLog, log } from "./debug.js";
import type { LmStudioConfig, LmStudioModelInfo, RefreshResult, RefreshProviderApi } from "./types.js";
import { ZERO_COST, LOCAL_OPENAI_COMPAT } from "./config/defaults.js";

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
    (await import("./models/fetch.js")).fetchLmStudioModelInfo(currentConfig, fetch),
  options?: { quiet?: boolean },
): Promise<RefreshResult> {
  const start = performance.now();
  debugLog(`refreshing provider '${config.providerName}' at ${config.baseUrl}`);
  debugLog("refresh start", { providerName: config.providerName, baseUrl: config.baseUrl, fetchTimeoutMs: config.fetchTimeoutMs });

  try {
    const { models, source } = await fetchModelInfo(config);
    debugLog("refresh result", { modelCount: models.length, source, modelIds: models.map((m) => m.id) });
    if (models.length === 0) {
      const message = `no models found, unregistering provider '${config.providerName}'`;
      if (options?.quiet) {
        debugLog(message);
      } else {
        log.warn(message);
      }
      pi.unregisterProvider?.(config.providerName);
    } else {
      const providerConfig = buildProviderConfig(config, models);
      pi.registerProvider(config.providerName, providerConfig);
      const ms = (performance.now() - start).toFixed(2);
      debugLog(`provider '${config.providerName}' registered with ${models.length} model${models.length === 1 ? "" : "s"} in ${ms}ms (source: ${source})`);
    }

    return { ok: true, count: models.length, models: models.map((m) => m.id), source };
  } catch (error) {
    const ms = (performance.now() - start).toFixed(2);
    const msg = error instanceof Error ? error.message : String(error);
    debugLog("refresh error", { providerName: config.providerName, error: msg, elapsedMs: ms });
    if (!options?.quiet) {
      log.error(`refresh failed for '${config.providerName}' after ${ms}ms: ${msg}`);
    }
    return { ok: false, error: msg };
  }
}
