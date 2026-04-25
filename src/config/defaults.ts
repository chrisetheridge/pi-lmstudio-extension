import type { LmStudioConfig } from "../types.js";

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

export { ZERO_COST, LOCAL_OPENAI_COMPAT };
