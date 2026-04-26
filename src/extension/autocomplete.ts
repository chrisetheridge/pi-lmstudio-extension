import type { LmStudioModelInfo } from "../types.js";

/** Autocomplete item structure matching @mariozechner/pi-tui */
export interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
}

/** Cache for completion data */
export interface CompletionCache {
  discoveredModelIds: string[];
  nativeModels: Array<{
    key: string;
    displayName: string;
    type: "llm" | "embedding" | "unknown";
    loadedInstanceIds: string[];
  }>;
  updatedAt?: number;
}

/** Default empty cache */
export const EMPTY_CACHE: CompletionCache = {
  discoveredModelIds: [],
  nativeModels: [],
};

/** Supported flags for /lmstudio-load command */
const LOAD_FLAGS = [
  "--context-length",
  "--flash-attention",
  "--eval-batch-size",
  "--num-experts",
  "--offload-kv-cache-to-gpu",
];

/**
 * Create a new empty completion cache
 */
export function createCompletionCache(): CompletionCache {
  return {
    discoveredModelIds: [],
    nativeModels: [],
  };
}

/**
 * Update cache from discovered model IDs (from OpenAI-compatible endpoint)
 */
export function updateCacheFromDiscoveredModels(
  cache: CompletionCache,
  modelIds: string[],
): CompletionCache {
  const uniqueIds = Array.from(new Set(modelIds)).sort();
  return {
    ...cache,
    discoveredModelIds: uniqueIds,
    updatedAt: Date.now(),
  };
}

/**
 * Update cache from native model info (from native endpoint)
 */
export function updateCacheFromNativeModels(
  cache: CompletionCache,
  models: LmStudioModelInfo[],
): CompletionCache {
  const uniqueModels = models
    .filter((m) => m.id && m.name)
    .map((m) => ({
      key: m.id,
      displayName: m.name,
      type: m.type,
      loadedInstanceIds: m.loadedInstanceIds || [],
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    ...cache,
    nativeModels: uniqueModels,
    updatedAt: Date.now(),
  };
}

/**
 * Filter completion items by prefix (case-insensitive substring match)
 */
function filterByPrefix(items: AutocompleteItem[], prefix: string): AutocompleteItem[] {
  if (!prefix) {
    return items;
  }
  const lowerPrefix = prefix.toLowerCase();
  return items.filter(
    (item) =>
      item.value.toLowerCase().includes(lowerPrefix) ||
      item.label.toLowerCase().includes(lowerPrefix),
  );
}

/**
 * Get model ID completions for commands like /lmstudio-load
 * Prefers native models (includes unloaded available models), falls back to discovered IDs
 */
export function getModelIdCompletions(
  cache: CompletionCache,
  prefix: string,
  maxResults: number = 20,
): AutocompleteItem[] | null {
  // Combine native models and discovered IDs, preferring native
  const allModels: AutocompleteItem[] = [];

  // Add native models first (they have display names and loaded state)
  for (const model of cache.nativeModels) {
    const loaded = model.loadedInstanceIds.length > 0;
    allModels.push({
      value: model.key,
      label: model.displayName,
      description: loaded ? `[loaded] ${model.type}` : model.type,
    });
  }

  // Add discovered IDs that aren't already in native models
  const nativeKeys = new Set(cache.nativeModels.map((m) => m.key));
  for (const id of cache.discoveredModelIds) {
    if (!nativeKeys.has(id)) {
      allModels.push({
        value: id,
        label: id,
        description: "discovered",
      });
    }
  }

  // Sort: loaded models first, then alphabetically
  allModels.sort((a, b) => {
    const aLoaded = a.description?.startsWith("[loaded]");
    const bLoaded = b.description?.startsWith("[loaded]");
    if (aLoaded && !bLoaded) return -1;
    if (!aLoaded && bLoaded) return 1;
    return a.label.localeCompare(b.label);
  });

  // Filter by prefix
  const filtered = filterByPrefix(allModels, prefix);

  // Limit results
  return filtered.slice(0, maxResults).length > 0 ? filtered.slice(0, maxResults) : null;
}

/**
 * Get loaded instance ID completions for commands like /lmstudio-unload
 * Returns null if no native cache exists (to avoid stale guesses)
 */
export function getLoadedInstanceIdCompletions(
  cache: CompletionCache,
  prefix: string,
  maxResults: number = 20,
): AutocompleteItem[] | null {
  if (cache.nativeModels.length === 0) {
    return null;
  }

  const allInstances: AutocompleteItem[] = [];

  for (const model of cache.nativeModels) {
    for (const instanceId of model.loadedInstanceIds) {
      allInstances.push({
        value: instanceId,
        label: `${model.displayName} (${instanceId})`,
        description: `loaded instance of ${model.type} model`,
      });
    }
  }

  // Filter by prefix
  const filtered = filterByPrefix(allInstances, prefix);

  // Limit results
  return filtered.slice(0, maxResults).length > 0 ? filtered.slice(0, maxResults) : null;
}

/**
 * Get flag completions for commands like /lmstudio-load
 * Returns flag suggestions when prefix starts with -- or is empty
 * Returns boolean suggestions when previous token is a boolean flag
 */
export function getFlagCompletions(
  prefix: string,
  maxResults: number = 10,
): AutocompleteItem[] | null {
  const trimmed = prefix.trim();

  // Check if last meaningful token is a boolean flag (even when prefix starts with --)
  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  const lastToken = tokens[tokens.length - 1];

  const booleanFlags = ["--flash-attention"];
  if (booleanFlags.includes(lastToken)) {
    return [
      { value: "true", label: "true", description: "enable option" },
      { value: "false", label: "false", description: "disable option" },
    ];
  }

  // If prefix starts with --, suggest flags matching the prefix
  if (trimmed.startsWith("--")) {
    const filtered = LOAD_FLAGS.filter((flag) => flag.includes(trimmed));
    const items: AutocompleteItem[] = filtered.map((flag) => ({
      value: flag,
      label: flag,
      description: "load option",
    }));
    return items.slice(0, maxResults).length > 0 ? items.slice(0, maxResults) : null;
  }

  // If prefix is empty, suggest all flags (for when user hasn't typed anything yet)
  if (!trimmed) {
    const items: AutocompleteItem[] = LOAD_FLAGS.map((flag) => ({
      value: flag,
      label: flag,
      description: "load option",
    }));
    return items.slice(0, maxResults).length > 0 ? items.slice(0, maxResults) : null;
  }

  // Non-flag prefix that doesn't match any pattern - return null
  return null;
}

/**
 * Get argument completions for /lmstudio-load.
 * Models are suggested before the first space; flags are suggested after.
 */
export function getLoadArgumentCompletions(
  cache: CompletionCache,
  argumentPrefix: string,
): AutocompleteItem[] | null {
  const trimmedLeading = argumentPrefix.replace(/^\s+/, "");
  if (!trimmedLeading) {
    return getModelIdCompletions(cache, "");
  }

  const endsWithSpace = /\s$/.test(argumentPrefix);
  const tokens = trimmedLeading.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 1 && !endsWithSpace) {
    return getModelIdCompletions(cache, tokens[0]);
  }

  const lastToken = tokens[tokens.length - 1] ?? "";
  const penultimateToken = tokens[tokens.length - 2] ?? "";

  if (lastToken === "--flash-attention" || penultimateToken === "--flash-attention") {
    return [
      { value: "true", label: "true", description: "enable option" },
      { value: "false", label: "false", description: "disable option" },
    ];
  }

  if (lastToken.startsWith("--") || argumentPrefix.endsWith(" ")) {
    return getFlagCompletions(lastToken.startsWith("--") ? lastToken : "");
  }

  return null;
}

/**
 * Parse argument prefix to determine what kind of completion is needed
 * Returns { type, prefix } where type is 'model' | 'instance' | 'flag' | 'boolean'
 */
export function parseArgumentPrefix(
  argumentPrefix: string,
  completionType: "model" | "instance",
): { type: "model" | "instance" | "flag" | "boolean"; prefix: string } {
  const trimmed = argumentPrefix.trim();

  // Check if last meaningful token is a boolean flag (even when prefix starts with --)
  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  const lastToken = tokens[tokens.length - 1];

  const booleanFlags = ["--flash-attention"];
  if (booleanFlags.includes(lastToken)) {
    return { type: "boolean", prefix: argumentPrefix };
  }

  // If prefix starts with --, it's a flag
  if (trimmed.startsWith("--")) {
    return { type: "flag", prefix: argumentPrefix };
  }

  // Otherwise return the requested completion type
  return { type: completionType, prefix: argumentPrefix };
}
