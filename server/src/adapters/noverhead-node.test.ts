import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerAdapterModule } from "./types.js";

const pi = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@paperclipai/adapter-pi-local/server", () => ({
  execute: pi.execute,
}));
import { createNOverheadNodeAdapter, nodeAdapterConfig, NODE_DEFAULT_URL, NODE_KEY, NODE_MODEL } from "./noverhead-node.js";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("NOverhead Node adapter preset", () => {
  const config = { url: "http://node:18766/v1", env: { [NODE_KEY]: "test-node-token" } };
  const adapter = () => createNOverheadNodeAdapter({ type: "pi_local" } as ServerAdapterModule);

  it("preserves Pi and keeps provider credentials out of the declarative model registry", () => {
    const built = nodeAdapterConfig({ ...config, model: "caller-selected-provider" });
    expect(built.model).toBe(NODE_MODEL);
    const env = built.env as Record<string, string>;
    expect(env.PAPERCLIP_PI_PROVIDERS).not.toContain("test-node-token");
    expect(JSON.parse(env.PAPERCLIP_PI_PROVIDERS).noverhead).toMatchObject({
      baseUrl: config.url, api: "openai-completions", apiKey: `{env:${NODE_KEY}}`,
    });
    expect(() => nodeAdapterConfig({ ...config, url: "http://169.254.169.254/v1" })).toThrow();
    expect(() => nodeAdapterConfig({ ...config, env: {} })).toThrow();
  });

  it("declares the Node URL through the built-in adapter config schema", () => {
    expect(adapter().getConfigSchema?.()).toEqual({
      fields: [{
        key: "url",
        label: "NOverhead Node endpoint",
        type: "text",
        default: NODE_DEFAULT_URL,
        required: true,
        hint: expect.stringContaining("managed separately as a Paperclip secret"),
      }],
    });
  });

  it("does not treat an unauthorized Node as a connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private-body", { status: 403 })));
    const denied = await adapter().testEnvironment({ companyId: "company", adapterType: "noverhead_node", config });
    expect(denied.status).toBe("fail");
    expect(JSON.stringify(denied)).not.toContain("private-body");
  });

  it("authenticates and verifies inference through the Node API, then retains the Pi execution machinery", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "node-default" }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "hello" } }] }));
    vi.stubGlobal("fetch", fetch);
    const result = await adapter().testEnvironment({ companyId: "company", adapterType: "noverhead_node", config });
    expect(result.status).toBe("pass");
    expect(result.checks.map(check => check.code)).toEqual(["noverhead_node_authenticated", "noverhead_node_inference_passed"]);
    expect(fetch).toHaveBeenNthCalledWith(1, "http://node:18766/v1/models", expect.objectContaining({ headers: { authorization: "Bearer test-node-token" } }));
    expect(fetch).toHaveBeenNthCalledWith(2, "http://node:18766/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer test-node-token", "content-type": "application/json" },
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({
      model: "node-default", messages: [{ role: "user", content: "Reply with the single word hello." }],
    });
    pi.execute.mockResolvedValue({ exitCode: 0, summary: "provider-result" });
    const execution = await adapter().execute({ config } as unknown as Parameters<ServerAdapterModule["execute"]>[0]);
    expect(execution.summary).toBe("provider-result");
    expect(pi.execute.mock.calls[0][0].config.model).toBe(NODE_MODEL);
  });

  it("reports an inference denial without including the response body", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "node-default" }] }))
      .mockResolvedValueOnce(new Response("private-body", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const result = await adapter().testEnvironment({ companyId: "company", adapterType: "noverhead_node", config });
    expect(result.status).toBe("fail");
    expect(JSON.stringify(result)).toContain("HTTP 401");
    expect(JSON.stringify(result)).not.toContain("private-body");
  });
});
