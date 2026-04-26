import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_CONFIG,
  buildProviderConfig,
  fetchOpenAiModels,
  fetchNativeModels,
  fetchLmStudioModels,
  loadConfigFromSettings,
  mergeConfig,
  parseModelsPayload,
  refreshProvider,
  createCompletionCache,
  updateCacheFromDiscoveredModels,
  updateCacheFromNativeModels,
  getModelIdCompletions,
  getLoadedInstanceIdCompletions,
  getFlagCompletions,
  getLoadArgumentCompletions,
  parseArgumentPrefix,
  EMPTY_CACHE,
  deriveNativeBaseUrl,
  loadLmStudioModel,
  unloadLmStudioModel,
  parseLoadArgs,
  parseBooleanArg,
  parseNativeModelsPayload,
  registerCommands,
  type LmStudioModelInfo,
  type LmStudioConfig,
} from "../src/index.js";

const ORIGINAL_PI_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (ORIGINAL_PI_CODING_AGENT_DIR === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = ORIGINAL_PI_CODING_AGENT_DIR;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rawModel = (id: string): LmStudioModelInfo => ({
  id,
  name: id,
  type: "llm",
  input: ["text"],
  loaded: false,
  loadedInstanceIds: [],
  source: "openai",
});

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function createAbortableFetchMock() {
  return vi.fn((_: FetchInput, init?: FetchInit) => {
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      const abortError = () => new DOMException("The operation was aborted.", "AbortError");

      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      signal?.addEventListener(
        "abort",
        () => {
          reject(abortError());
        },
        { once: true },
      );
    });
  });
}

describe("mergeConfig", () => {
  it("uses defaults when settings are missing", () => {
    expect(mergeConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("merges global and project settings with project taking precedence", () => {
    const globalConfig: Partial<LmStudioConfig> = {
      baseUrl: "http://global.test/v1",
      providerName: "global-local",
      contextWindow: 64000,
      reasoning: true,
    };
    const projectConfig: Partial<LmStudioConfig> = {
      providerName: "local",
      maxTokens: 8192,
    };

    expect(mergeConfig(globalConfig, projectConfig)).toEqual({
      ...DEFAULT_CONFIG,
      baseUrl: "http://global.test/v1",
      nativeBaseUrl: "http://global.test/api/v1",
      providerName: "local",
      contextWindow: 64000,
      maxTokens: 8192,
      reasoning: true,
    });
  });

  it("normalizes baseUrl by removing trailing slashes", () => {
    expect(mergeConfig({ baseUrl: "http://localhost:1234/v1///" }).baseUrl).toBe("http://localhost:1234/v1");
  });

  it("accepts a bare LM Studio server URL and normalizes it for OpenAI-compatible requests", () => {
    expect(mergeConfig({ baseUrl: "http://192.168.2.88:1234" })).toMatchObject({
      baseUrl: "http://192.168.2.88:1234/v1",
      nativeBaseUrl: "http://192.168.2.88:1234/api/v1",
    });
  });
});

describe("loadConfigFromSettings", () => {
  it("reads lmstudio settings from global and project Pi settings files", () => {
    const root = join(tmpdir(), `pi-extension-lmstudio-${crypto.randomUUID()}`);
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ lmstudio: { baseUrl: "http://global.test/v1", contextWindow: 64000 } }),
    );
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ lmstudio: { maxTokens: 2048 } }));

    const loaded = loadConfigFromSettings(cwd, agentDir);

    expect(loaded.config).toEqual({
      ...DEFAULT_CONFIG,
      baseUrl: "http://global.test/v1",
      nativeBaseUrl: "http://global.test/api/v1",
      contextWindow: 64000,
      maxTokens: 2048,
    });
    expect(loaded.warnings).toEqual([]);
  });

  it("ignores invalid settings JSON and records a warning", () => {
    const root = join(tmpdir(), `pi-extension-lmstudio-${crypto.randomUUID()}`);
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "settings.json"), "{not json");

    const loaded = loadConfigFromSettings(cwd, agentDir);

    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.warnings[0]).toContain("Could not parse");
  });
});

describe("parseBooleanArg", () => {
  it("returns true for truthy values", () => {
    expect(parseBooleanArg("true")).toBe(true);
    expect(parseBooleanArg("True")).toBe(true);
    expect(parseBooleanArg("TRUE")).toBe(true);
    expect(parseBooleanArg("1")).toBe(true);
    expect(parseBooleanArg("yes")).toBe(true);
    expect(parseBooleanArg("Yes")).toBe(true);
  });

  it("returns false for falsy values", () => {
    expect(parseBooleanArg("false")).toBe(false);
    expect(parseBooleanArg("False")).toBe(false);
    expect(parseBooleanArg("0")).toBe(false);
    expect(parseBooleanArg("no")).toBe(false);
    expect(parseBooleanArg("No")).toBe(false);
  });

  it("returns undefined for unrecognized values", () => {
    expect(parseBooleanArg("maybe")).toBeUndefined();
    expect(parseBooleanArg("2")).toBeUndefined();
    expect(parseBooleanArg("")).toBeUndefined();
    expect(parseBooleanArg("yesno")).toBeUndefined();
  });

  it("trims whitespace before parsing", () => {
    expect(parseBooleanArg("  true  ")).toBe(true);
    expect(parseBooleanArg("  false  ")).toBe(false);
  });
});

describe("parseLoadArgs", () => {
  it("parses a bare model key", () => {
    expect(parseLoadArgs("qwen3.6-35b")).toEqual({ model: "qwen3.6-35b" });
  });

  it("parses model key with context-length", () => {
    expect(parseLoadArgs("qwen3.6-35b --context-length 4096")).toEqual({
      model: "qwen3.6-35b",
      contextLength: 4096,
    });
  });

  it("parses model key with flash-attention true", () => {
    expect(parseLoadArgs("qwen3.6-35b --flash-attention true")).toEqual({
      model: "qwen3.6-35b",
      flashAttention: true,
    });
  });

  it("parses model key with flash-attention false", () => {
    expect(parseLoadArgs("qwen3.6-35b --flash-attention false")).toEqual({
      model: "qwen3.6-35b",
      flashAttention: false,
    });
  });

  it("defaults flash-attention to true when no value", () => {
    expect(parseLoadArgs("qwen3.6-35b --flash-attention")).toEqual({
      model: "qwen3.6-35b",
      flashAttention: true,
    });
  });

  it("parses all supported flags", () => {
    const result = parseLoadArgs(
      "qwen3.6-35b --context-length 8192 --flash-attention true --eval-batch-size 32 --num-experts 4 --offload-kv-cache-to-gpu true",
    );
    expect(result).toEqual({
      model: "qwen3.6-35b",
      contextLength: 8192,
      flashAttention: true,
      evalBatchSize: 32,
      numExperts: 4,
      offloadKvCacheToGpu: true,
    });
  });

  it("rejects non-positive context-length", () => {
    expect(() => parseLoadArgs("model --context-length 0")).toThrow("expected a positive integer");
    expect(() => parseLoadArgs("model --context-length -1")).toThrow("expected a positive integer");
    expect(() => parseLoadArgs("model --context-length abc")).toThrow("expected a positive integer");
  });

  it("rejects non-positive eval-batch-size", () => {
    expect(() => parseLoadArgs("model --eval-batch-size 0")).toThrow("expected a positive integer");
  });

  it("rejects non-positive num-experts", () => {
    expect(() => parseLoadArgs("model --num-experts -5")).toThrow("expected a positive integer");
  });

  it("rejects invalid boolean for flash-attention", () => {
    expect(() => parseLoadArgs("model --flash-attention maybe")).toThrow("expects true or false");
  });

  it("rejects invalid boolean for offload-kv-cache-to-gpu", () => {
    expect(() => parseLoadArgs("model --offload-kv-cache-to-gpu maybe")).toThrow("expects true or false");
  });

  it("rejects unknown flags", () => {
    expect(() => parseLoadArgs("model --unknown-flag value")).toThrow("unknown flag");
  });

  it("rejects unexpected positional arguments after model key", () => {
    expect(() => parseLoadArgs("model extra")).toThrow("unexpected argument");
  });

  it("rejects empty args", () => {
    expect(() => parseLoadArgs("")).toThrow("model key is required");
    expect(() => parseLoadArgs("   ")).toThrow("model key is required");
  });

  it("rejects flag without value for context-length", () => {
    expect(() => parseLoadArgs("model --context-length")).toThrow("requires a positive integer");
  });

  it("rejects flag without value for eval-batch-size", () => {
    expect(() => parseLoadArgs("model --eval-batch-size")).toThrow("requires a positive integer");
  });

  it("rejects flag without value for num-experts", () => {
    expect(() => parseLoadArgs("model --num-experts")).toThrow("requires a positive integer");
  });

  it("parses model key with slash", () => {
    expect(parseLoadArgs("unsloth/qwen3.6-35b-a3b")).toEqual({ model: "unsloth/qwen3.6-35b-a3b" });
  });
});

describe("deriveNativeBaseUrl", () => {
  it("replaces trailing /v1 with /api/v1", () => {
    expect(deriveNativeBaseUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/api/v1");
  });

  it("appends /api/v1 when no /v1 suffix", () => {
    expect(deriveNativeBaseUrl("http://localhost:1234")).toBe("http://localhost:1234/api/v1");
  });

  it("strips trailing slashes before deriving", () => {
    expect(deriveNativeBaseUrl("http://localhost:1234/v1///")).toBe("http://localhost:1234/api/v1");
  });

  it("handles IP-based URLs", () => {
    expect(deriveNativeBaseUrl("http://192.168.2.88:1234/v1")).toBe("http://192.168.2.88:1234/api/v1");
  });

  it("handles HTTPS URLs", () => {
    expect(deriveNativeBaseUrl("https://example.com/v1")).toBe("https://example.com/api/v1");
  });
});

describe("parseNativeModelsPayload", () => {
  it("parses current LM Studio native models responses with a models array", async () => {
    const { parseNativeModelsPayload } = await import("../src/index.js");

    expect(
      parseNativeModelsPayload({
        models: [
          {
            type: "llm",
            key: "unsloth/qwen3.6-35b-a3b",
            display_name: "Qwen3.6 35B A3B UD",
            max_context_length: 262144,
            loaded_instances: [
              {
                id: "unsloth/qwen3.6-35b-a3b",
                config: {
                  context_length: 64213,
                },
              },
            ],
            capabilities: {
              vision: true,
              trained_for_tool_use: true,
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "unsloth/qwen3.6-35b-a3b",
        name: "Qwen3.6 35B A3B UD",
        input: ["text", "image"],
        loaded: true,
        loadedInstanceIds: ["unsloth/qwen3.6-35b-a3b"],
        contextWindow: 64213,
      }),
    ]);
  });

  it("parses models without loaded instances", () => {
    const result = parseNativeModelsPayload({
      models: [
        {
          type: "llm",
          key: "unloaded-model",
          display_name: "Unloaded Model",
          max_context_length: 131072,
          loaded_instances: [],
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "unloaded-model",
        name: "Unloaded Model",
        loaded: false,
        loadedInstanceIds: [],
      }),
    ]);
  });

  it("parses models with vision capability", () => {
    const result = parseNativeModelsPayload({
      models: [
        {
          type: "llm",
          key: "vision-model",
          display_name: "Vision Model",
          max_context_length: 4096,
          loaded_instances: [],
          capabilities: {
            vision: true,
            trained_for_tool_use: false,
          },
        },
      ],
    });

    expect(result[0].input).toContain("image");
  });

  it("parses models with tool-use capability", () => {
    const result = parseNativeModelsPayload({
      models: [
        {
          type: "llm",
          key: "tool-model",
          display_name: "Tool Model",
          max_context_length: 4096,
          loaded_instances: [],
          capabilities: {
            vision: false,
            trained_for_tool_use: true,
          },
        },
      ],
    });

    expect(result[0].toolUse).toBe(true);
  });

  it("parses models without capabilities", () => {
    const result = parseNativeModelsPayload({
      models: [
        {
          type: "llm",
          key: "basic-model",
          display_name: "Basic Model",
          max_context_length: 4096,
          loaded_instances: [],
        },
      ],
    });

    expect(result[0].input).toEqual(["text"]);
    expect(result[0].toolUse).toBeUndefined();
  });

  it("returns empty array for empty data array", () => {
    expect(parseNativeModelsPayload({ data: [] })).toEqual([]);
  });

  it("returns empty array for empty models array", () => {
    expect(parseNativeModelsPayload({ models: [] })).toEqual([]);
  });

  it("throws on non-object response", () => {
    expect(() => parseNativeModelsPayload(null as never)).toThrow("Expected native /api/v1/models response with a data or models array");
  });
});

describe("parseModelsPayload", () => {
  it("parses OpenAI-compatible model list responses", () => {
    const models = parseModelsPayload({
      data: [{ id: "qwen2.5-coder-7b" }, { id: "llama-3.2" }],
    });

    expect(models).toEqual(["qwen2.5-coder-7b", "llama-3.2"]);
  });

  it("filters malformed model entries", () => {
    const models = parseModelsPayload({
      data: [{ id: "valid" }, { id: "" }, { object: "model" }, null],
    });

    expect(models).toEqual(["valid"]);
  });

  it("throws on malformed response shapes", () => {
    expect(() => parseModelsPayload({ models: [] })).toThrow("Expected LM Studio /models response");
  });
});

describe("parseNativeModelsPayload", () => {
  it("parses current LM Studio native models responses with a models array", async () => {
    const { parseNativeModelsPayload } = await import("../src/index.js");

    expect(
      parseNativeModelsPayload({
        models: [
          {
            type: "llm",
            key: "unsloth/qwen3.6-35b-a3b",
            display_name: "Qwen3.6 35B A3B UD",
            max_context_length: 262144,
            loaded_instances: [
              {
                id: "unsloth/qwen3.6-35b-a3b",
                config: {
                  context_length: 64213,
                },
              },
            ],
            capabilities: {
              vision: true,
              trained_for_tool_use: true,
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "unsloth/qwen3.6-35b-a3b",
        name: "Qwen3.6 35B A3B UD",
        input: ["text", "image"],
        loaded: true,
        loadedInstanceIds: ["unsloth/qwen3.6-35b-a3b"],
        contextWindow: 64213,
      }),
    ]);
  });
});

describe("buildProviderConfig", () => {
  it("uses provider local while preserving raw model IDs", () => {
    const config = mergeConfig();
    const providerConfig = buildProviderConfig(config, [rawModel("qwen2.5-coder-7b")]);

    expect(config.providerName).toBe("local");
    expect(providerConfig.models).toMatchObject([
      {
        id: "qwen2.5-coder-7b",
        name: "qwen2.5-coder-7b",
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStrictMode: false,
          maxTokensField: "max_tokens",
        },
      },
    ]);
    expect(providerConfig).toMatchObject({
      baseUrl: "http://localhost:1234/v1",
      apiKey: "lmstudio",
      api: "openai-completions",
    });
  });
});

describe("fetchOpenAiModels", () => {
  it("fetches models from the normalized /v1/models endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "local-model" }] })));

    await expect(fetchOpenAiModels(mergeConfig({ baseUrl: "http://192.168.2.88:1234" }), fetchImpl)).resolves.toEqual([
      expect.objectContaining({ id: "local-model" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith("http://192.168.2.88:1234/v1/models", expect.objectContaining({ method: "GET" }));
  });
});

describe("fetchNativeModels", () => {
  it("fetches models from the native /api/v1/models endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ models: [{ type: "llm", key: "native-model" }] })));

    await expect(fetchNativeModels(mergeConfig({ baseUrl: "http://192.168.2.88:1234" }), fetchImpl)).resolves.toEqual([
      expect.objectContaining({ id: "native-model" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith("http://192.168.2.88:1234/api/v1/models", expect.objectContaining({ method: "GET" }));
  });

  it("uses modelManagementTimeoutMs for timeout", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ models: [] })));

    await fetchNativeModels(
      mergeConfig({ baseUrl: "http://localhost:1234/v1", modelManagementTimeoutMs: 300000 }),
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:1234/api/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws on non-OK response", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" }));

    await expect(
      fetchNativeModels(mergeConfig({ baseUrl: "http://localhost:1234/v1" }), fetchImpl),
    ).rejects.toThrow("native model fetch failed: 404 Not Found");
  });

  it("throws on timeout", async () => {
    const fetchImpl = createAbortableFetchMock();

    await expect(
      fetchNativeModels(
        mergeConfig({ baseUrl: "http://localhost:1234/v1", modelManagementTimeoutMs: 50 }),
        fetchImpl,
      ),
    ).rejects.toThrow("native model fetch timed out after 50ms");
  }, 1000);

  it("sends auth header when apiKey is set", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ models: [] })));

    await fetchNativeModels(
      mergeConfig({ baseUrl: "http://localhost:1234/v1", apiKey: "secret-key" }),
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:1234/api/v1/models",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("uses explicit nativeBaseUrl when provided", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ models: [] })));

    await fetchNativeModels(
      mergeConfig({ baseUrl: "http://localhost:1234/v1", nativeBaseUrl: "http://custom:9999/api/v1" }),
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith("http://custom:9999/api/v1/models", expect.any(Object));
  });
});

describe("loadLmStudioModel", () => {
  it("sends correct request body with model key only", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ type: "llm", instance_id: "inst-1", load_time_seconds: 2.5, status: "success" })),
    );

    const result = await loadLmStudioModel(
      mergeConfig({ baseUrl: "http://localhost:1234/v1" }),
      { model: "qwen3.6-35b" },
      fetchImpl,
    );

    expect(result.instance_id).toBe("inst-1");
    expect(result.load_time_seconds).toBe(2.5);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:1234/api/v1/models/load",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ model: "qwen3.6-35b", echo_load_config: true }),
      }),
    );
  });

  it("sends optional load settings in request body", async () => {
    let callArgs: FetchInit | undefined;
    const fetchImpl = vi.fn(async (_input: FetchInput, init?: FetchInit) => {
      callArgs = init;
      return new Response(JSON.stringify({ type: "llm", instance_id: "inst-2", load_time_seconds: 3.1, status: "success" }));
    });

    await loadLmStudioModel(
      mergeConfig({ baseUrl: "http://localhost:1234/v1" }),
      {
        model: "qwen3.6-35b",
        contextLength: 8192,
        flashAttention: true,
        evalBatchSize: 32,
        numExperts: 4,
        offloadKvCacheToGpu: true,
      },
      fetchImpl,
    );

    expect(callArgs).toBeDefined();
    const requestInit = callArgs as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body).toEqual({
      model: "qwen3.6-35b",
      echo_load_config: true,
      context_length: 8192,
      flash_attention: true,
      eval_batch_size: 32,
      num_experts: 4,
      offload_kv_cache_to_gpu: true,
    });
  });

  it("uses modelManagementTimeoutMs for timeout", async () => {
    const fetchImpl = createAbortableFetchMock();

    await expect(
      loadLmStudioModel(
        mergeConfig({ baseUrl: "http://localhost:1234/v1", modelManagementTimeoutMs: 100 }),
        { model: "qwen3.6-35b" },
        fetchImpl,
      ),
    ).rejects.toThrow("model load timed out after 100ms");
  }, 1000);

  it("throws on non-OK response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("model not found", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      loadLmStudioModel(mergeConfig({ baseUrl: "http://localhost:1234/v1" }), { model: "nonexistent" }, fetchImpl),
    ).rejects.toThrow("model load failed: 404 Not Found");
  });

  it("includes error body in message", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('{"error": "model not found"}', { status: 404, statusText: "Not Found" }),
    );

    await expect(
      loadLmStudioModel(mergeConfig({ baseUrl: "http://localhost:1234/v1" }), { model: "nonexistent" }, fetchImpl),
    ).rejects.toThrow("model load failed: 404 Not Found");
  });

  it("sends auth header when apiKey is set", async () => {
    let callArgs: FetchInit | undefined;
    const fetchImpl = vi.fn(async (_input: FetchInput, init?: FetchInit) => {
      callArgs = init;
      return new Response(JSON.stringify({ type: "llm", instance_id: "inst-1", load_time_seconds: 1.0, status: "success" }));
    });

    await loadLmStudioModel(
      mergeConfig({ baseUrl: "http://localhost:1234/v1", apiKey: "secret" }),
      { model: "qwen3.6-35b" },
      fetchImpl,
    );

    expect(callArgs).toBeDefined();
    expect((callArgs as RequestInit).headers).toMatchObject({ Authorization: "Bearer lm" });
  });

  it("uses explicit nativeBaseUrl when provided", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ type: "llm", instance_id: "inst-1", load_time_seconds: 1.0, status: "success" })),
    );

    await loadLmStudioModel(
      mergeConfig({ baseUrl: "http://localhost:1234/v1", nativeBaseUrl: "http://custom:9999/api/v1" }),
      { model: "qwen3.6-35b" },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith("http://custom:9999/api/v1/models/load", expect.any(Object));
  });

  it("parses load_config from response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          type: "llm",
          instance_id: "inst-1",
          load_time_seconds: 2.0,
          status: "success",
          load_config: { context_length: 4096, flash_attention: true },
        }),
      ),
    );

    const result = await loadLmStudioModel(
      mergeConfig({ baseUrl: "http://localhost:1234/v1" }),
      { model: "qwen3.6-35b" },
      fetchImpl,
    );

    expect(result.load_config).toEqual({ context_length: 4096, flash_attention: true });
  });
});

describe("unloadLmStudioModel", () => {
  it("sends correct request body with instance_id", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ instance_id: "inst-1" })),
    );

    const result = await unloadLmStudioModel(
      mergeConfig({ baseUrl: "http://localhost:1234/v1" }),
      "inst-1",
      fetchImpl,
    );

    expect(result.instance_id).toBe("inst-1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:1234/api/v1/models/unload",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ instance_id: "inst-1" }),
      }),
    );
  });

  it("uses modelManagementTimeoutMs for timeout", async () => {
    const fetchImpl = createAbortableFetchMock();

    await expect(
      unloadLmStudioModel(
        mergeConfig({ baseUrl: "http://localhost:1234/v1", modelManagementTimeoutMs: 100 }),
        "inst-1",
        fetchImpl,
      ),
    ).rejects.toThrow("model unload timed out after 100ms");
  }, 1000);

  it("throws on non-OK response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("instance not found", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      unloadLmStudioModel(mergeConfig({ baseUrl: "http://localhost:1234/v1" }), "nonexistent", fetchImpl),
    ).rejects.toThrow("model unload failed: 404 Not Found");
  });

  it("sends auth header when apiKey is set", async () => {
    let callArgs: FetchInit | undefined;
    const fetchImpl = vi.fn(async (_input: FetchInput, init?: FetchInit) => {
      callArgs = init;
      return new Response(JSON.stringify({ instance_id: "inst-1" }));
    });

    await unloadLmStudioModel(
      mergeConfig({ baseUrl: "http://localhost:1234/v1", apiKey: "secret" }),
      "inst-1",
      fetchImpl,
    );

    expect(callArgs).toBeDefined();
    expect((callArgs as RequestInit).headers).toMatchObject({ Authorization: "Bearer lm" });
  });

  it("uses explicit nativeBaseUrl when provided", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ instance_id: "inst-1" })),
    );

    await unloadLmStudioModel(
      mergeConfig({ baseUrl: "http://localhost:1234/v1", nativeBaseUrl: "http://custom:9999/api/v1" }),
      "inst-1",
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith("http://custom:9999/api/v1/models/unload", expect.any(Object));
  });
});

describe("fetchLmStudioModels", () => {
  it("fetches and parses models from baseUrl/models", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "local-model" }] })));

    await expect(fetchLmStudioModels("http://localhost:1234/v1", fetchImpl)).resolves.toEqual(["local-model"]);
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:1234/v1/models", expect.objectContaining({ method: "GET" }));
  });

  it("throws a useful error for non-OK responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" }));

    await expect(fetchLmStudioModels("http://localhost:1234/v1", fetchImpl)).rejects.toThrow(
      "model fetch failed: 404 Not Found",
    );
  });
});

describe("refreshProvider", () => {
  it("registers the configured provider with fetched models", async () => {
    const pi = { registerProvider: vi.fn() };
    const result = await refreshProvider(pi, mergeConfig(), async () => ({ models: [rawModel("raw-model")], source: "openai" }));

    expect(result).toEqual({ ok: true, count: 1, models: ["raw-model"], source: "openai" });
    expect(pi.registerProvider).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({
        models: [expect.objectContaining({ id: "raw-model" })],
      }),
    );
  });

  it("does not throw or register models when fetch fails", async () => {
    const pi = { registerProvider: vi.fn() };
    const result = await refreshProvider(pi, mergeConfig(), async () => {
      throw new Error("connection refused");
    });

    expect(result).toEqual({ ok: false, error: "connection refused" });
    expect(pi.registerProvider).not.toHaveBeenCalled();
  });
});

describe("lmStudioExtension", () => {
  it("renders /lmstudio-status through ui.notify", async () => {
    const handlers = new Map<string, (args: string, ctx: { cwd: string; ui: { notify: (message: string, kind?: string) => void } }) => Promise<void>>();
    const pi = {
      registerCommand: vi.fn((name: string, definition: { handler: (args: string, ctx: { cwd: string; ui: { notify: (message: string, kind?: string) => void } }) => Promise<void> }) => {
        handlers.set(name, definition.handler);
      }),
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      registerFlag: vi.fn(),
      getFlag: vi.fn(),
    };

    registerCommands(
      pi as never,
      async () => ({ ok: true, count: 0, models: [], source: "openai" }),
      () => ({
        lastResult: { ok: true, count: 2, models: ["model-a", "model-b"], source: "native" },
        lastWarnings: ["first warning", "second warning"],
        lastRefreshAt: Date.now() - 4000,
        lastRefreshReason: "manual",
        lastRegisteredModels: ["model-a", "model-b"],
      }),
    );

    const notify = vi.fn();
    await handlers.get("lmstudio-status")?.("", { cwd: process.cwd(), ui: { notify } });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Endpoint:"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Warnings:"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Status: OK - 2 model(s) registered"), "info");
  });

  it("renders /lmstudio-refresh through ui.notify", async () => {
    const handlers = new Map<string, (args: string, ctx: { cwd: string; ui: { notify: (message: string, kind?: string) => void } }) => Promise<void>>();
    const pi = {
      registerCommand: vi.fn((name: string, definition: { handler: (args: string, ctx: { cwd: string; ui: { notify: (message: string, kind?: string) => void } }) => Promise<void> }) => {
        handlers.set(name, definition.handler);
      }),
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      registerFlag: vi.fn(),
      getFlag: vi.fn(),
    };

    registerCommands(pi as never, async () => ({ ok: true, count: 3, models: ["a", "b", "c"], source: "openai" }));

    const notify = vi.fn();
    await handlers.get("lmstudio-refresh")?.("", { cwd: process.cwd(), ui: { notify } });

    expect(notify).toHaveBeenCalledWith("OK: 3 model(s) registered", "info");
  });

  it("registers discovered models during extension load so saved defaults can restore", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [{ type: "llm", key: "startup-model" }] }))));
    const root = join(tmpdir(), `pi-extension-lmstudio-extension-${crypto.randomUUID()}`);
    const agentDir = join(root, "agent");
    mkdirSync(agentDir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const { default: lmStudioExtension } = await import("../src/index.js");
    const pi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(),
      on: vi.fn(),
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      registerCommand: vi.fn(),
    };

    await lmStudioExtension(pi as never);

    await flushAsync();
    expect(pi.registerProvider).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({
        models: [expect.objectContaining({ id: "startup-model" })],
      }),
    );
  });

  it("does not fail load when LM Studio is unavailable", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));
    const root = join(tmpdir(), `pi-extension-lmstudio-extension-${crypto.randomUUID()}`);
    const agentDir = join(root, "agent");
    mkdirSync(agentDir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const { default: lmStudioExtension } = await import("../src/index.js");
    const pi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(),
      on: vi.fn(),
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      registerCommand: vi.fn(),
    };

    await expect(lmStudioExtension(pi as never)).resolves.toBeUndefined();
    await flushAsync();
    expect(pi.registerProvider).not.toHaveBeenCalled();
  });

  it("resolves the debug flag on session_start after CLI flags are available", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
    const root = join(tmpdir(), `pi-extension-lmstudio-extension-${crypto.randomUUID()}`);
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const { default: lmStudioExtension, isDebugEnabled } = await import("../src/index.js");
    const handlers = new Map<string, (event: unknown, ctx: { cwd: string; ui: { notify: () => void } }) => Promise<void>>();
    let flagsAvailable = false;
    const pi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn((name: string) => (flagsAvailable && name === "lmstudio-debug" ? true : undefined)),
      on: vi.fn((event: string, handler: (event: unknown, ctx: { cwd: string; ui: { notify: () => void } }) => Promise<void>) => {
        handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      registerCommand: vi.fn(),
    };

    await lmStudioExtension(pi as never);

    expect(isDebugEnabled()).toBe(false);

    flagsAvailable = true;
    await handlers.get("session_start")?.({ type: "session_start", reason: "new" }, { cwd, ui: { notify: vi.fn() } });

    expect(isDebugEnabled()).toBe(true);
  });

  it("blocks until /lmstudio-loaded finishes fetching native models", async () => {
    vi.resetModules();
    let resolveFetch!: (value: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal("fetch", fetchImpl);

    const handlers = new Map<string, (args: string, ctx: { cwd: string; ui: { notify: (message: string, kind?: string) => void } }) => Promise<void>>();
    const pi = {
      registerCommand: vi.fn((name: string, definition: { handler: (args: string, ctx: { cwd: string; ui: { notify: (message: string, kind?: string) => void } }) => Promise<void> }) => {
        handlers.set(name, definition.handler);
      }),
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      registerFlag: vi.fn(),
      getFlag: vi.fn(),
    };

    registerCommands(pi as never, async () => ({ ok: true, count: 0, models: [], source: "openai" }));

    const notify = vi.fn();
    const pending = handlers.get("lmstudio-loaded")?.("", { cwd: process.cwd(), ui: { notify } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    let settled = false;
    void pending?.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveFetch(new Response(JSON.stringify({ models: [{ type: "llm", key: "loaded-model", loaded_instances: [{ id: "inst-1" }] }] })));
    await pending;

    expect(settled).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Loaded 1 model(s)"), "info");
  });
});

describe("autocomplete helpers", () => {
  describe("createCompletionCache", () => {
    it("returns an empty cache with no models", () => {
      const cache = createCompletionCache();
      expect(cache.discoveredModelIds).toEqual([]);
      expect(cache.nativeModels).toEqual([]);
      expect(cache.updatedAt).toBeUndefined();
    });
  });

  describe("updateCacheFromDiscoveredModels", () => {
    it("stores discovered model IDs and removes duplicates", () => {
      const cache = createCompletionCache();
      const updated = updateCacheFromDiscoveredModels(cache, ["model-a", "model-b", "model-a"]);
      expect(updated.discoveredModelIds).toEqual(["model-a", "model-b"]);
    });

    it("sorts model IDs deterministically", () => {
      const cache = createCompletionCache();
      const updated = updateCacheFromDiscoveredModels(cache, ["z-model", "a-model", "m-model"]);
      expect(updated.discoveredModelIds).toEqual(["a-model", "m-model", "z-model"]);
    });

    it("updates the timestamp on successful update", () => {
      const cache = createCompletionCache();
      const updated = updateCacheFromDiscoveredModels(cache, ["model-a"]);
      expect(updated.updatedAt).toBeDefined();
      expect(typeof updated.updatedAt).toBe("number");
    });

    it("preserves existing native models when updating discovered IDs", () => {
      const cache = createCompletionCache();
      const withNative = updateCacheFromNativeModels(cache, [
        { id: "native-model", name: "Native Model", type: "llm", input: ["text"], loadedInstanceIds: [] },
      ]);
      const updated = updateCacheFromDiscoveredModels(withNative, ["discovered-1"]);
      expect(updated.nativeModels).toHaveLength(1);
      expect(updated.discoveredModelIds).toEqual(["discovered-1"]);
    });
  });

  describe("updateCacheFromNativeModels", () => {
    it("stores native model metadata with display names", () => {
      const cache = createCompletionCache();
      const models: LmStudioModelInfo[] = [
        { id: "qwen3.6-35b", name: "Qwen3.6 35B A3B UD", type: "llm", input: ["text"], loadedInstanceIds: ["inst-1"] },
      ];
      const updated = updateCacheFromNativeModels(cache, models);
      expect(updated.nativeModels).toHaveLength(1);
      expect(updated.nativeModels[0].key).toBe("qwen3.6-35b");
      expect(updated.nativeModels[0].displayName).toBe("Qwen3.6 35B A3B UD");
      expect(updated.nativeModels[0].type).toBe("llm");
      expect(updated.nativeModels[0].loadedInstanceIds).toEqual(["inst-1"]);
    });

    it("filters out models without id or name", () => {
      const cache = createCompletionCache();
      const models: LmStudioModelInfo[] = [
        { id: "valid-model", name: "Valid Model", type: "llm", input: ["text"], loadedInstanceIds: [] },
        { id: "", name: "Empty ID", type: "llm", input: ["text"], loadedInstanceIds: [] },
        { id: "no-name", name: "", type: "llm", input: ["text"], loadedInstanceIds: [] },
      ];
      const updated = updateCacheFromNativeModels(cache, models);
      expect(updated.nativeModels).toHaveLength(1);
      expect(updated.nativeModels[0].key).toBe("valid-model");
    });

    it("sorts native models by key", () => {
      const cache = createCompletionCache();
      const models: LmStudioModelInfo[] = [
        { id: "z-model", name: "Z Model", type: "llm", input: ["text"], loadedInstanceIds: [] },
        { id: "a-model", name: "A Model", type: "llm", input: ["text"], loadedInstanceIds: [] },
      ];
      const updated = updateCacheFromNativeModels(cache, models);
      expect(updated.nativeModels[0].key).toBe("a-model");
      expect(updated.nativeModels[1].key).toBe("z-model");
    });
  });

  describe("getModelIdCompletions", () => {
    it("returns null when cache is empty", () => {
      const cache = createCompletionCache();
      expect(getModelIdCompletions(cache, "")).toBeNull();
    });

    it("returns model IDs from discovered models", () => {
      const cache = updateCacheFromDiscoveredModels(createCompletionCache(), ["model-a", "model-b"]);
      const completions = getModelIdCompletions(cache, "")!;
      expect(completions).toHaveLength(2);
      expect(completions[0].value).toBe("model-a");
    });

    it("prefers native models over discovered IDs", () => {
      const cache = createCompletionCache();
      const updated = updateCacheFromNativeModels(cache, [
        { id: "native-model", name: "Native Model", type: "llm", input: ["text"], loadedInstanceIds: ["inst-1"] },
      ]);
      const withDiscovered = updateCacheFromDiscoveredModels(updated, ["discovered-1"]);
      const completions = getModelIdCompletions(withDiscovered, "")!;
      expect(completions).toHaveLength(2);
      // Native model should appear first (it's loaded)
      expect(completions[0].value).toBe("native-model");
    });

    it("filters by prefix case-insensitively", () => {
      const cache = updateCacheFromDiscoveredModels(createCompletionCache(), ["qwen2.5-coder-7b", "llama-3.2"]);
      const completions = getModelIdCompletions(cache, "QWEN")!;
      expect(completions).toHaveLength(1);
      expect(completions[0].value).toBe("qwen2.5-coder-7b");
    });

    it("limits results to maxResults", () => {
      const cache = updateCacheFromDiscoveredModels(createCompletionCache(), [
        "model-a", "model-b", "model-c", "model-d", "model-e",
      ]);
      const completions = getModelIdCompletions(cache, "", 3)!;
      expect(completions).toHaveLength(3);
    });

    it("sorts loaded models first when native info is available", () => {
      const cache = createCompletionCache();
      const updated = updateCacheFromNativeModels(cache, [
        { id: "loaded-model", name: "Loaded Model", type: "llm", input: ["text"], loadedInstanceIds: ["inst-1"] },
        { id: "unloaded-model", name: "Unloaded Model", type: "llm", input: ["text"], loadedInstanceIds: [] },
      ]);
      const completions = getModelIdCompletions(updated, "")!;
      expect(completions[0].value).toBe("loaded-model");
    });

    it("returns null when no models match prefix", () => {
      const cache = updateCacheFromDiscoveredModels(createCompletionCache(), ["model-a"]);
      expect(getModelIdCompletions(cache, "nonexistent")).toBeNull();
    });
  });

  describe("getLoadedInstanceIdCompletions", () => {
    it("returns null when no native cache exists", () => {
      const cache = createCompletionCache();
      expect(getLoadedInstanceIdCompletions(cache, "")).toBeNull();
    });

    it("returns loaded instance IDs from native models", () => {
      const cache = updateCacheFromNativeModels(createCompletionCache(), [
        { id: "model-a", name: "Model A", type: "llm", input: ["text"], loadedInstanceIds: ["inst-1", "inst-2"] },
      ]);
      const completions = getLoadedInstanceIdCompletions(cache, "")!;
      expect(completions).toHaveLength(2);
      expect(completions[0].value).toBe("inst-1");
    });

    it("filters by prefix case-insensitively", () => {
      const cache = updateCacheFromNativeModels(createCompletionCache(), [
        { id: "model-a", name: "Model A", type: "llm", input: ["text"], loadedInstanceIds: ["inst-1"] },
      ]);
      const completions = getLoadedInstanceIdCompletions(cache, "INST")!;
      expect(completions).toHaveLength(1);
    });

    it("includes display name in label", () => {
      const cache = updateCacheFromNativeModels(createCompletionCache(), [
        { id: "qwen3.6-35b", name: "Qwen3.6 35B A3B UD", type: "llm", input: ["text"], loadedInstanceIds: ["inst-1"] },
      ]);
      const completions = getLoadedInstanceIdCompletions(cache, "")!;
      expect(completions[0].label).toContain("Qwen3.6 35B A3B UD");
    });

    it("limits results to maxResults", () => {
      const cache = updateCacheFromNativeModels(createCompletionCache(), [
        { id: "model-a", name: "Model A", type: "llm", input: ["text"], loadedInstanceIds: ["inst-1", "inst-2", "inst-3"] },
      ]);
      const completions = getLoadedInstanceIdCompletions(cache, "", 2)!;
      expect(completions).toHaveLength(2);
    });

    it("returns null when no instances match prefix", () => {
      const cache = updateCacheFromNativeModels(createCompletionCache(), [
        { id: "model-a", name: "Model A", type: "llm", input: ["text"], loadedInstanceIds: ["inst-1"] },
      ]);
      expect(getLoadedInstanceIdCompletions(cache, "nonexistent")).toBeNull();
    });
  });

  describe("getFlagCompletions", () => {
    it("suggests flags when prefix starts with --", () => {
      const completions = getFlagCompletions("--flash")!;
      expect(completions).toHaveLength(1);
      expect(completions[0].value).toBe("--flash-attention");
    });

    it("suggests all flags when prefix is empty", () => {
      const completions = getFlagCompletions("")!;
      expect(completions).toHaveLength(5);
      expect(completions.map((c) => c.value)).toContain("--context-length");
    });

    it("suggests true/false for boolean flags", () => {
      const completions = getFlagCompletions("--flash-attention ")!;
      expect(completions).toHaveLength(2);
      expect(completions.map((c) => c.value)).toEqual(["true", "false"]);
    });

    it("returns null for non-flag prefixes and non-boolean flags", () => {
      const completions = getFlagCompletions("model-name");
      expect(completions).toBeNull();
    });

    it("limits results to maxResults", () => {
      const completions = getFlagCompletions("", 2)!;
      expect(completions).toHaveLength(2);
    });
  });

  describe("getLoadArgumentCompletions", () => {
    it("suggests model IDs before first space", () => {
      const cache = updateCacheFromDiscoveredModels(createCompletionCache(), ["qwen3.6-35b", "llama-3.2"]);
      const completions = getLoadArgumentCompletions(cache, "qw")!;
      expect(completions.map((item) => item.value)).toContain("qwen3.6-35b");
    });

    it("suggests flags after model name", () => {
      const cache = updateCacheFromDiscoveredModels(createCompletionCache(), ["qwen3.6-35b"]);
      const completions = getLoadArgumentCompletions(cache, "qwen3.6-35b ")!;
      expect(completions.map((item) => item.value)).toContain("--context-length");
      expect(completions.map((item) => item.value)).toContain("--flash-attention");
    });

    it("suggests boolean values after flash-attention", () => {
      const cache = updateCacheFromDiscoveredModels(createCompletionCache(), ["qwen3.6-35b"]);
      const completions = getLoadArgumentCompletions(cache, "qwen3.6-35b --flash-attention ")!;
      expect(completions.map((item) => item.value)).toEqual(["true", "false"]);
    });
  });

  describe("parseArgumentPrefix", () => {
    it("identifies flag prefix when starting with -- (non-boolean flag)", () => {
      const result = parseArgumentPrefix("--context-length ", "model");
      expect(result.type).toBe("flag");
      expect(result.prefix).toBe("--context-length ");
    });

    it("identifies boolean prefix when last token is a boolean flag", () => {
      const result = parseArgumentPrefix("qwen2.5 --flash-attention ", "model");
      expect(result.type).toBe("boolean");
    });

    it("returns model type when no flag prefix", () => {
      const result = parseArgumentPrefix("qwen2.5", "model");
      expect(result.type).toBe("model");
      expect(result.prefix).toBe("qwen2.5");
    });

    it("returns instance type when specified", () => {
      const result = parseArgumentPrefix("inst-1", "instance");
      expect(result.type).toBe("instance");
    });
  });
});
