export { DEFAULT_CONFIG } from "./config/defaults.js";
// Re-export public config functions
export { loadConfigFromSettings } from "./config/load.js";
export { mergeConfig } from "./config/merge.js";
// Re-export public utilities
export { debugLog, isDebugEnabled } from "./debug.js";
// Re-export autocomplete types
export type { AutocompleteItem, CompletionCache } from "./extension/autocomplete.js";
// Re-export autocomplete functions
export {
  createCompletionCache,
  EMPTY_CACHE,
  getFlagCompletions,
  getLoadArgumentCompletions,
  getLoadedInstanceIdCompletions,
  getModelIdCompletions,
  parseArgumentPrefix,
  updateCacheFromDiscoveredModels,
  updateCacheFromNativeModels,
} from "./extension/autocomplete.js";
// Re-export command functions
export { registerCommands } from "./extension/commands.js";
// Re-export the extension entry point
export { default } from "./extension/index.js";
export {
  fetchLmStudioModelInfo,
  fetchLmStudioModels,
  fetchNativeModels,
  fetchOpenAiModels,
  loadLmStudioModel,
  unloadLmStudioModel,
} from "./models/fetch.js";
export { parseBooleanArg, parseLoadArgs } from "./models/load-args.js";
// Re-export public model functions
export {
  parseModelsPayload,
  parseNativeModelsPayload,
  parseOpenAiModelsPayload,
} from "./models/parse.js";
// Re-export public provider functions
export { buildProviderConfig, refreshProvider } from "./provider.js";
export type {
  LmStudioConfig,
  LmStudioModelInfo,
  LoadedConfig,
  LoadModelCommandArgs,
  LoadModelResult,
  MetadataSource,
  ModelInput,
  RefreshResult,
  UnloadModelResult,
} from "./types.js";
export { deriveNativeBaseUrl, normalizeOpenAiBaseUrl } from "./url.js";
