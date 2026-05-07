export type ModelInput = "text" | "image";

export interface LmStudioModelInfo {
  id: string;
  name: string;
  type: "llm" | "embedding" | "unknown";
  input: ModelInput[];
  reasoning?: boolean;
  toolUse?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  loaded?: boolean;
  loadedInstanceIds: string[];
  source?: "openai" | "native";
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
  modelManagementTimeoutMs: number;
  autoRefresh: boolean;
  refreshIntervalMs: number;
  notifyAutoRefreshChanges: boolean;
}

/** Arguments for the /lmstudio-load command */
export interface LoadModelCommandArgs {
  model: string;
  contextLength?: number;
  flashAttention?: boolean;
  evalBatchSize?: number;
  numExperts?: number;
  offloadKvCacheToGpu?: boolean;
}

/** Result from a successful model load */
export interface LoadModelResult {
  type: string;
  instance_id: string;
  load_time_seconds: number;
  status: string;
  load_config?: Record<string, unknown>;
}

/** Result from a successful model unload */
export interface UnloadModelResult {
  instance_id: string;
}

export interface LoadedConfig {
  config: LmStudioConfig;
  warnings: string[];
  lastDiscoverySource?: "openai" | "native" | undefined;
}

export type RefreshResult =
  | { ok: true; count: number; models: string[]; source: "openai" | "native" }
  | { ok: false; error: string };

export type RefreshReason = "startup" | "manual" | "auto";

export interface LmStudioRefreshState {
  lastResult: RefreshResult | undefined;
  lastWarnings: string[];
  lastRefreshAt: number | undefined;
  lastRefreshReason: RefreshReason | undefined;
  lastRegisteredModels: string[];
}

export type FetchLike = typeof fetch;

export interface ModelChange {
  added: string[];
  removed: string[];
}

interface RefreshProviderApi {
  registerProvider(
    name: string,
    config: import("@mariozechner/pi-coding-agent").ProviderConfig,
  ): void;
  unregisterProvider?(name: string): void;
}

export { RefreshProviderApi };
