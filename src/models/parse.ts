import { debugLog } from "../debug.js";
import type { LmStudioModelInfo } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseModelsPayload(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Expected LM Studio /models response with a data array");
  }

  return payload.data
    .map((entry) => (isRecord(entry) && typeof entry.id === "string" ? entry.id.trim() : ""))
    .filter((id) => id.length > 0);
}

/** Extract capabilities from an OpenAI-compatible model entry. */
function extractCapabilities(entry: Record<string, unknown>): { vision: boolean; toolUse: boolean } {
  const capabilities = entry.capabilities;
  let vision = false;
  let toolUse = false;

  if (Array.isArray(capabilities)) {
    for (const cap of capabilities) {
      if (typeof cap === "string") {
        if (cap === "vision" || cap === "image_input") vision = true;
        if (cap === "tool_use") toolUse = true;
      }
    }
  } else if (isRecord(capabilities)) {
    if (typeof capabilities.vision === "boolean") vision = capabilities.vision;
    if (typeof capabilities.image_input === "boolean") vision = vision || capabilities.image_input;
    if (typeof capabilities.tool_use === "boolean") toolUse = capabilities.tool_use;
  }

  return { vision, toolUse };
}

/** Parse an OpenAI-compatible /v1/models response into model info descriptors. */
export function parseOpenAiModelsPayload(payload: unknown): LmStudioModelInfo[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Expected LM Studio /v1/models response with a data array");
  }

  debugLog("openai models payload", { dataLength: payload.data.length, rawPayload: payload });

  const results: LmStudioModelInfo[] = [];

  for (const entry of payload.data) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) continue;

    const { vision, toolUse } = extractCapabilities(entry);

    results.push({
      id,
      name: id,
      type: "llm",
      input: vision ? ["text", "image"] : ["text"],
      toolUse: toolUse || undefined,
      loaded: false,
      loadedInstanceIds: [],
      source: "openai",
    });
  }

  debugLog("parsed openai models", results);
  return results;
}

/** Parse a native /api/v1/models response into model info descriptors. */
export function parseNativeModelsPayload(payload: unknown): LmStudioModelInfo[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Expected native /api/v1/models response with a data array");
  }

  debugLog("native models payload", { dataLength: payload.data.length, rawPayload: payload });

  const results: LmStudioModelInfo[] = [];

  for (const entry of payload.data) {
    if (!isRecord(entry)) continue;

    const type = entry.type;
    const modelType = type === "llm" || type === "embedding" ? type : "unknown";

    // Skip embedding models unless explicitly requested
    if (modelType === "embedding") {
      debugLog("skipping embedding model", { id: (entry as Record<string, unknown>).key });
      continue;
    }

    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    const displayName = typeof entry.display_name === "string" ? entry.display_name.trim() : "";
    const id = key || "";
    if (!id) continue;

    const capabilities = isRecord(entry.capabilities) ? entry.capabilities : undefined;
    const vision = capabilities && typeof capabilities.vision === "boolean" ? capabilities.vision : false;
    const toolUse = capabilities && typeof capabilities.trained_for_tool_use === "boolean" ? capabilities.trained_for_tool_use : false;

    // Determine context length from loaded instances first, then max_context_length
    let contextWindow: number | undefined;
    const loadedInstances = Array.isArray(entry.loaded_instances) ? entry.loaded_instances : [];
    const loadedInstanceIds: string[] = [];

    for (const inst of loadedInstances) {
      if (!isRecord(inst)) continue;
      const instId = typeof inst.id === "string" ? inst.id : undefined;
      if (instId) loadedInstanceIds.push(instId);
      const instCtx = typeof inst.context_length === "number" ? inst.context_length : undefined;
      if (instCtx !== undefined && contextWindow === undefined) {
        contextWindow = instCtx;
      }
    }

    const maxCtxLength = typeof entry.max_context_length === "number" ? entry.max_context_length : undefined;

    results.push({
      id,
      name: displayName || id,
      type: modelType,
      input: vision ? ["text", "image"] : ["text"],
      toolUse: toolUse || undefined,
      contextWindow: contextWindow ?? maxCtxLength,
      loaded: loadedInstances.length > 0,
      loadedInstanceIds,
      source: "native",
    });
  }

  debugLog("parsed native models", results);
  return results;
}
