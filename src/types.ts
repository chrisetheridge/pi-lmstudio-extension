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
  registerProvider(name: string, config: import("@mariozechner/pi-coding-agent").ProviderConfig): void;
  unregisterProvider?(name: string): void;
}

export { FetchLike, RefreshProviderApi };
