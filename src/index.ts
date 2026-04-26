// Re-export public types
export type {
  LmStudioModelInfo,
  LmStudioConfig,
  LoadedConfig,
  RefreshResult,
  ModelInput,
  MetadataSource,
  LoadModelCommandArgs,
  LoadModelResult,
  UnloadModelResult,
} from "./types.js";

// Re-export autocomplete types
export type { AutocompleteItem, CompletionCache } from "./extension/autocomplete.js";

// Re-export public utilities
export { debugLog, isDebugEnabled } from "./debug.js";

// Re-export public config functions
export { loadConfigFromSettings } from "./config/load.js";
export { mergeConfig } from "./config/merge.js";
export { DEFAULT_CONFIG } from "./config/defaults.js";
export { deriveNativeBaseUrl, normalizeOpenAiBaseUrl } from "./url.js";

// Re-export public model functions
export {
  parseModelsPayload,
  parseOpenAiModelsPayload,
  parseNativeModelsPayload,
} from "./models/parse.js";
export {
  fetchLmStudioModels,
  fetchOpenAiModels,
  fetchNativeModels,
  fetchLmStudioModelInfo,
  loadLmStudioModel,
  unloadLmStudioModel,
} from "./models/fetch.js";
export { parseLoadArgs, parseBooleanArg } from "./models/load-args.js";

// Re-export public provider functions
export { buildProviderConfig, refreshProvider } from "./provider.js";

// Re-export the extension entry point
export { default } from "./extension/index.js";

// Re-export autocomplete functions
export {
  createCompletionCache,
  updateCacheFromDiscoveredModels,
  updateCacheFromNativeModels,
  getModelIdCompletions,
  getLoadedInstanceIdCompletions,
  getFlagCompletions,
  parseArgumentPrefix,
  EMPTY_CACHE,
} from "./extension/autocomplete.js";

// Re-export command functions
export {
  registerCommands,
  setLastResult,
  setLastWarnings,
  getLastDiscoverySource,
  updateCompletionCacheFromNativeModels,
  getCompletionCache,
} from "./extension/commands.js";
