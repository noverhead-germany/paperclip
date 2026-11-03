import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { AdapterExecutionContext } from "./types.js";

const mcp = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  listTools: vi.fn(async () => ({ tools: [] as Array<Record<string, unknown>> })),
  callTool: vi.fn(async () => ({ content: [{ type: "text", text: "tool-result" }] })),
  close: vi.fn(async () => {}),
  transportUrls: [] as string[],
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mcp.connect;
    listTools = mcp.listTools;
    callTool = mcp.callTool;
    close = mcp.close;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL) { mcp.transportUrls.push(url.toString()); }
  },
}));

import { createNOverheadNodeAdapter, execute, NODE_DEFAULT_URL, NODE_KEY, NODE_MODEL } from "./noverhead-node.js";

const baseConfig = { url: "http://node:18766/v1", env: { [NODE_KEY]: "test-node-token" }, promptTemplate: "{{context.prompt}}" };
function context(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: { id: "agent-1", companyId: "company-1", name: "Chief of Stuff", adapterType: "noverhead_node", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: baseConfig,
    context: { prompt: "Antworte ausschließlich mit paperclip-e2e-ok" },
    onLog: vi.fn(async () => {}),
    onUsage: vi.fn(async () => {}),
    ...overrides,
  };
}

function completion(content: string, usage = { prompt_tokens: 12, completion_tokens: 3 }) {
  return Response.json({ choices: [{ message: { role: "assistant", content } }], usage });
}

beforeEach(() => {
  mcp.connect.mockClear(); mcp.listTools.mockReset().mockResolvedValue({ tools: [] });
  mcp.callTool.mockReset().mockResolvedValue({ content: [{ type: "text", text: "tool-result" }] });
  mcp.close.mockClear(); mcp.transportUrls.length = 0;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("NOverhead Node direct adapter", () => {
  it("declares the Node endpoint and stable model without Pi runtime metadata", () => {
    const adapter = createNOverheadNodeAdapter();
    expect(adapter.type).toBe("noverhead_node");
    expect(adapter.models).toEqual([{ id: NODE_MODEL, label: "Node configured provider" }]);
    expect(adapter.runtimeToolDelivery).toBe("native_mcp");
    expect(adapter.getRuntimeCommandSpec).toBeUndefined();
    expect(adapter.getConfigSchema?.()).toMatchObject({ fields: [{ key: "url", default: NODE_DEFAULT_URL }] });
  });

  it("authenticates model discovery and a small inference in the adapter connection test", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "node-default" }] }))
      .mockResolvedValueOnce(completion("hello"));
    vi.stubGlobal("fetch", fetch);
    const result = await createNOverheadNodeAdapter().testEnvironment({ companyId: "company-1", adapterType: "noverhead_node", config: baseConfig });
    expect(result.status).toBe("pass");
    expect(fetch).toHaveBeenNthCalledWith(1, "http://node:18766/v1/models", expect.objectContaining({
      headers: { authorization: "Bearer test-node-token" },
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "http://node:18766/v1/chat/completions", expect.objectContaining({
      headers: { authorization: "Bearer test-node-token", "content-type": "application/json" },
      signal: expect.any(AbortSignal),
    }));
  });

  it("does not expose response bodies or resolved credentials on a failed connection test", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private-provider-error", { status: 401 })));
    const result = await createNOverheadNodeAdapter().testEnvironment({ companyId: "company-1", adapterType: "noverhead_node", config: baseConfig });
    expect(result.status).toBe("fail");
    expect(JSON.stringify(result)).not.toContain("private-provider-error");
    expect(JSON.stringify(result)).not.toContain("test-node-token");
  });

  it("sends the Paperclip task context directly to the authenticated Node and records usage/session", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => completion("paperclip-e2e-ok"));
    vi.stubGlobal("fetch", fetch);
    const onUsage = vi.fn(async () => {});
    const result = await execute(context({ onUsage }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("http://node:18766/v1/chat/completions", expect.objectContaining({
      method: "POST", headers: { authorization: "Bearer test-node-token", "content-type": "application/json" },
    }));
    const body = JSON.parse(fetch.mock.calls[0][1]?.body as string);
    expect(body.model).toBe("node-default");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Antworte ausschließlich mit paperclip-e2e-ok" });
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, summary: "paperclip-e2e-ok", provider: "noverhead_node", model: NODE_MODEL });
    expect(result.sessionParams).toMatchObject({ version: 1, baseUrl: baseConfig.url });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      usage: { inputTokens: 12, outputTokens: 3 }, usageBasis: "per_run", complete: true, billingType: "unknown",
    }));
  });

  it("uses Paperclip MCP tools through OpenAI tool calls and refreshes the inventory each run", async () => {
    mcp.listTools.mockResolvedValue({ tools: [{ name: "echo", description: "Echo input", inputSchema: { type: "object", properties: { value: { type: "string" } } } }] });
    mcp.callTool.mockResolvedValue({ content: [{ type: "text", text: "authorized-tool-result" }] });
    const toolName = `mcp0_paperclip_echo_${createHash("sha256").update("paperclip\0echo").digest("hex").slice(0, 10)}`;
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: toolName, arguments: "{\"value\":\"x\"}" } }],
        } }],
        usage: { prompt_tokens: 30, completion_tokens: 4 },
      }))
      .mockResolvedValueOnce(completion("done", { prompt_tokens: 34, completion_tokens: 2 }));
    vi.stubGlobal("fetch", fetch);
    const ctx = context({ runtimeMcp: { getServers: () => [{ name: "paperclip", url: "http://paperclip.test/mcp", token: "mcp-secret", connectionId: "runtime-tools" }] } });
    const result = await execute(ctx);

    const firstRequest = JSON.parse(fetch.mock.calls[0][1]?.body as string);
    expect(firstRequest.tools[0]).toMatchObject({ type: "function", function: { name: toolName } });
    expect(mcp.transportUrls).toEqual(["http://paperclip.test/mcp"]);
    expect(mcp.callTool).toHaveBeenCalledWith({ name: "echo", arguments: { value: "x" } }, undefined, {});
    const secondRequest = JSON.parse(fetch.mock.calls[1][1]?.body as string);
    expect(secondRequest.messages.some((message: { role: string; content: string }) => message.role === "tool" && message.content === "authorized-tool-result")).toBe(true);
    expect(result.summary).toBe("done");
    expect(mcp.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("mcp-secret");
  });

  it("continues the saved conversation on the next Paperclip run", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(completion("first"))
      .mockResolvedValueOnce(completion("second"));
    vi.stubGlobal("fetch", fetch);
    const first = await execute(context());
    await execute(context({ runId: "run-2", runtime: { sessionId: first.sessionId!, sessionParams: first.sessionParams!, sessionDisplayId: first.sessionDisplayId!, taskKey: null }, context: { prompt: "follow up", paperclipTaskMarkdown: "new assignment" } }));
    const resumed = JSON.parse(fetch.mock.calls[1][1]?.body as string);
    expect(resumed.messages).toContainEqual({ role: "assistant", content: "first" });
    expect(resumed.messages.at(-1)).toEqual({ role: "user", content: expect.stringContaining("follow up") });
  });

  it("passes Paperclip cancellation to the Node and reports cancellation without calling it a timeout", async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    const pending = execute(context({ signal: controller.signal }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    const result = await pending;
    expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal);
    expect(result).toMatchObject({ exitCode: null, timedOut: false, errorCode: "cancelled" });
  });

  it("classifies the Node's own provider timeout without changing its timeout policy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "provider_timeout" } }, { status: 504 })));
    const result = await execute(context());
    expect(result).toMatchObject({ exitCode: 1, timedOut: true, errorCode: "provider_timeout" });
    expect(result.errorMessage).toContain("HTTP 504");
  });

  it("keeps authorization and provider error payloads out of diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private response body", { status: 401 })));
    const result = await execute(context());
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("HTTP 401");
    expect(JSON.stringify(result)).not.toContain("private response body");
  });
});
