import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AdapterExecutionContext, AdapterExecutionResult, ServerAdapterModule } from "./types.js";
import {
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE,
  hydrateFreshSessionHandoff,
  isPaperclipRecoveryWakePayload,
  joinPromptSections,
  renderTemplate,
  selectInitialCommunicationGuidance,
  selectPaperclipPromptSections,
} from "@paperclipai/adapter-utils/server-utils";

export const NODE_MODEL = "noverhead/node-default";
export const NODE_KEY = "NOVERHEAD_NODE_API_KEY";
export const NODE_DEFAULT_URL = "http://node:18766/v1";

const SESSION_VERSION = 1;
const MAX_TOOL_ROUNDS = 16;
const MAX_TOOL_CALLS = 64;
const MAX_TOOL_RESULT_CHARS = 24_000;
const MAX_PRIOR_SESSION_CHARS = 48_000;
const MAX_PRIOR_SESSION_TURNS = 16;

interface NodeConfig {
  baseUrl: string;
  token: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}

interface SessionState {
  version: number;
  baseUrl: string;
  turns: ChatMessage[][];
}

interface ToolBinding {
  server: RuntimeMcpServer;
  client: Client;
  remoteName: string;
  publicName: string;
}

interface RuntimeMcpServer {
  name: string;
  url: string;
  token: string;
  connectionId: string;
}

interface CompletionResponse {
  id?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string | Array<{ type?: string; text?: string }> | null;
      tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { code?: string; type?: string };
}

function resolveNodeConfig(config: Record<string, unknown>): NodeConfig {
  const address = typeof config.url === "string" && config.url.trim()
    ? config.url.trim() : process.env.NOVERHEAD_NODE_URL?.trim() || NODE_DEFAULT_URL;
  const url = new URL(address);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !["node", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.pathname.replace(/\/$/, "") !== "/v1") {
    throw new Error("Use the configured local NOverhead Node /v1 endpoint.");
  }
  const env = config.env && typeof config.env === "object" && !Array.isArray(config.env)
    ? config.env as Record<string, unknown> : {};
  const token = typeof env[NODE_KEY] === "string" ? env[NODE_KEY].trim() : "";
  if (!token) throw new Error("A resolved NOverhead Node bearer credential is required.");
  return { baseUrl: url.toString().replace(/\/$/, ""), token };
}

function readSession(value: unknown, baseUrl: string): SessionState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const session = value as Partial<SessionState>;
  if (session.version !== SESSION_VERSION || session.baseUrl !== baseUrl || !Array.isArray(session.turns)) return null;
  const turns = session.turns.filter((turn): turn is ChatMessage[] => Array.isArray(turn)
    && turn.every(message => !!message && typeof message === "object"
      && ["user", "assistant", "tool"].includes((message as ChatMessage).role)));
  return { version: SESSION_VERSION, baseUrl, turns };
}

function compactPriorTurns(turns: ChatMessage[][]): ChatMessage[][] {
  const retained = [...turns];
  while (retained.length > MAX_PRIOR_SESSION_TURNS
    || JSON.stringify(retained).length > MAX_PRIOR_SESSION_CHARS) {
    if (retained.length <= 1) break;
    retained.shift();
  }
  return retained;
}

function makePrompt(ctx: AdapterExecutionContext, resumedSession: boolean): { system: string; user: string } {
  const { config, context, agent, runId } = ctx;
  const template = typeof config.promptTemplate === "string" && config.promptTemplate.trim()
    ? config.promptTemplate
    : context.conversationMode === true
      ? DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE
      : DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE;
  const templateData = { agentId: agent.id, companyId: agent.companyId, runId, company: { id: agent.companyId }, agent,
    run: { id: runId, source: "on_demand" }, context };
  const systemTemplate = template;
  const system = renderTemplate(systemTemplate, templateData);
  const { taskContextNote, wakePrompt } = selectPaperclipPromptSections(context, {
    resumedSession, includeCommunicationGuidance: false,
  });
  const bootstrapTemplate = typeof config.bootstrapPromptTemplate === "string" ? config.bootstrapPromptTemplate : "";
  const bootstrap = !resumedSession && bootstrapTemplate.trim()
    ? renderTemplate(bootstrapTemplate, templateData).trim() : "";
  const heartbeatPrompt = (resumedSession && wakePrompt.length > 0)
    || isPaperclipRecoveryWakePayload(context.paperclipWake)
    || !(typeof config.promptTemplate === "string" && config.promptTemplate.trim())
    ? "" : renderTemplate(template, templateData);
  const user = joinPromptSections([
    selectInitialCommunicationGuidance(context, { resumedSession }),
    bootstrap,
    wakePrompt,
    taskContextNote,
    typeof context.paperclipSessionHandoffMarkdown === "string" ? context.paperclipSessionHandoffMarkdown : "",
    heartbeatPrompt,
  ]);
  return { system, user };
}

async function loadInstructions(ctx: AdapterExecutionContext): Promise<string> {
  const configured = typeof ctx.config.instructionsFilePath === "string" ? ctx.config.instructionsFilePath.trim() : "";
  if (!configured) return "";
  if (ctx.executionTarget?.kind === "remote") {
    throw new Error("NOverhead Node direct execution cannot read instructions from a remote workspace.");
  }
  const workspace = ctx.context.paperclipWorkspace && typeof ctx.context.paperclipWorkspace === "object"
    ? ctx.context.paperclipWorkspace as Record<string, unknown> : {};
  const cwd = typeof workspace.cwd === "string" && workspace.cwd.trim() ? workspace.cwd : process.cwd();
  const filePath = path.resolve(cwd, configured);
  const contents = await readFile(filePath, "utf8");
  return `${contents}\n\nThe above agent instructions were loaded from ${filePath}. Resolve relative references from ${path.dirname(filePath)}/.`;
}

function usageFrom(response: CompletionResponse): { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null {
  const promptTokens = response.usage?.prompt_tokens;
  const outputTokens = response.usage?.completion_tokens;
  if (!Number.isFinite(promptTokens) || !Number.isFinite(outputTokens)) return null;
  const cached = Math.max(0, Math.min(promptTokens!, Number(response.usage?.prompt_tokens_details?.cached_tokens ?? 0)));
  return { inputTokens: Math.max(0, promptTokens! - cached), outputTokens: Math.max(0, outputTokens!), ...(cached ? { cachedInputTokens: cached } : {}) };
}

function addUsage(total: { inputTokens: number; outputTokens: number; cachedInputTokens: number }, next: ReturnType<typeof usageFrom>) {
  if (!next) return;
  total.inputTokens += next.inputTokens;
  total.outputTokens += next.outputTokens;
  total.cachedInputTokens += next.cachedInputTokens ?? 0;
}

type ChatContent = string | Array<{ type?: string; text?: string }> | null | undefined;

function responseText(content: ChatContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.flatMap(part => typeof part?.text === "string" ? [part.text] : []).join("\n");
  return "";
}

function safeToolName(server: string, tool: string, index: number): string {
  const prefix = `mcp${index}_${server}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  const suffix = createHash("sha256").update(`${server}\0${tool}`).digest("hex").slice(0, 10);
  return `${prefix}_${suffix}`;
}

async function connectRuntimeTools(ctx: AdapterExecutionContext): Promise<{ tools: Array<Record<string, unknown>>; bindings: Map<string, ToolBinding>; close: () => Promise<void> }> {
  const tools: Array<Record<string, unknown>> = [];
  const bindings = new Map<string, ToolBinding>();
  const clients: Client[] = [];
  try {
    for (const [serverIndex, server] of (ctx.runtimeMcp?.getServers() ?? []).entries()) {
      if (ctx.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { authorization: `Bearer ${server.token}` } },
      });
      const client = new Client({ name: "paperclip-noverhead-node", version: "1.0.0" }, { capabilities: {} });
      await client.connect(transport);
      clients.push(client);
      const inventory = await client.listTools({}, ctx.signal ? { signal: ctx.signal } : {});
      for (const tool of inventory.tools) {
        const publicName = safeToolName(server.name, tool.name, serverIndex);
        const schema = tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} };
        tools.push({ type: "function", function: { name: publicName, description: tool.description ?? "", parameters: schema } });
        bindings.set(publicName, { server, client, remoteName: tool.name, publicName });
      }
    }
    return { tools, bindings, close: async () => { await Promise.allSettled(clients.map(client => client.close())); } };
  } catch (error) {
    await Promise.allSettled(clients.map(client => client.close()));
    throw error;
  }
}

function toolResultText(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "");
  const value = result as { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown; isError?: boolean };
  const chunks = (value.content ?? []).flatMap(part => part.type === "text" && typeof part.text === "string" ? [part.text] : []);
  if (value.structuredContent !== undefined) chunks.push(JSON.stringify(value.structuredContent));
  const text = chunks.join("\n") || JSON.stringify(result);
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[tool output truncated]` : text;
}

async function postCompletion(baseUrl: string, token: string, messages: ChatMessage[], tools: Array<Record<string, unknown>>, signal?: AbortSignal): Promise<CompletionResponse> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "node-default", messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
    ...(signal ? { signal } : {}),
    redirect: "error",
  });
  let body: CompletionResponse = {};
  try { body = await response.json() as CompletionResponse; } catch { /* status remains the safe diagnostic */ }
  if (!response.ok) {
    const code = typeof body.error?.code === "string" && /^[a-z0-9_-]{1,64}$/i.test(body.error.code) ? ` (${body.error.code})` : "";
    throw Object.assign(new Error(`NOverhead Node returned HTTP ${response.status}${code}.`), {
      status: response.status, providerCode: body.error?.code,
    });
  }
  return body;
}

async function reportUsage(ctx: AdapterExecutionContext, usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number }, complete: boolean): Promise<void> {
  await ctx.onUsage?.({
    provider: "noverhead_node", biller: "unknown", model: "node-default", billingType: "unknown", costStatus: "unpriced",
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ...(usage.cachedInputTokens ? { cachedInputTokens: usage.cachedInputTokens } : {}) },
    usageBasis: "per_run", complete,
  });
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { baseUrl, token } = resolveNodeConfig(ctx.config);
  if (ctx.executionTarget?.kind === "remote" && ctx.config.instructionsFilePath) {
    return { exitCode: 1, signal: null, timedOut: false, errorCode: "remote_instructions_unsupported",
      errorMessage: "NOverhead Node direct execution cannot read instructions from a remote workspace.", provider: "noverhead_node", model: "node-default", billingType: "unknown", clearSession: false };
  }
  const previous = readSession(ctx.runtime.sessionParams, baseUrl);
  const resumedSession = previous !== null;
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const sessionId = previous ? ctx.runtime.sessionId || randomUUID() : randomUUID();
  let turns = previous?.turns ?? [];
  try {
    await hydrateFreshSessionHandoff(ctx, { resumedSession });
    const prompt = makePrompt(ctx, resumedSession);
    const instructions = await loadInstructions(ctx);
    const system = joinPromptSections([instructions, prompt.system]);
    const messages: ChatMessage[] = [{ role: "system", content: system }, ...turns.flat(), { role: "user", content: prompt.user }];
    const currentTurn: ChatMessage[] = [{ role: "user", content: prompt.user }];
    turns = [...turns, currentTurn];
    await ctx.onCancellationReady?.();
    ctx.onDispatch?.();
    const runtime = await connectRuntimeTools(ctx);
    let toolCallCount = 0;
    let finalText = "";
    try {
      await ctx.onLog("stdout", `[paperclip] Sending authenticated inference request to NOverhead Node (${NODE_MODEL}).\n`);
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await postCompletion(baseUrl, token, messages, runtime.tools, ctx.signal);
        addUsage(usage, usageFrom(response));
        const choice = response.choices?.[0];
        const assistant = choice?.message;
        if (!assistant) throw new Error("NOverhead Node returned no completion choice.");
        const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
        const assistantMessage: ChatMessage = {
          role: "assistant", content: typeof assistant.content === "string" ? assistant.content : responseText(assistant.content),
          ...(toolCalls.length ? { tool_calls: toolCalls.filter(call => typeof call.id === "string" && typeof call.function?.name === "string")
            .map(call => ({ id: call.id!, type: "function" as const, function: { name: call.function!.name!, arguments: call.function?.arguments ?? "{}" } })) } : {}),
        };
        currentTurn.push(assistantMessage);
        messages.push(assistantMessage);
        if (!toolCalls.length) {
          finalText = responseText(assistant.content);
          break;
        }
        for (const call of toolCalls) {
          toolCallCount++;
          if (toolCallCount > MAX_TOOL_CALLS) throw new Error(`Agent exceeded the ${MAX_TOOL_CALLS} runtime-tool call limit for one run.`);
          if (!call.id || !call.function?.name) throw new Error("NOverhead Node returned an invalid tool call.");
          const binding = runtime.bindings.get(call.function.name);
          if (!binding) {
            const failedTool: ChatMessage = { role: "tool", tool_call_id: call.id, content: "Tool is not available in the current Paperclip run." };
            messages.push(failedTool); currentTurn.push(failedTool); continue;
          }
          let args: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(call.function.arguments || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("tool arguments must be an object");
            args = parsed as Record<string, unknown>;
          } catch {
            const failedTool: ChatMessage = { role: "tool", tool_call_id: call.id, content: "Tool arguments were not valid JSON object data." };
            messages.push(failedTool); currentTurn.push(failedTool); continue;
          }
          await ctx.onEvent?.({ eventType: "tool_call", payload: { name: binding.remoteName, server: binding.server.name } });
          await ctx.onLog("stdout", `[paperclip] Invoking Paperclip MCP tool ${binding.server.name}.${binding.remoteName}.\n`);
          const result = await binding.client.callTool({ name: binding.remoteName, arguments: args }, undefined,
            ctx.signal ? { signal: ctx.signal } : {});
          const toolMessage: ChatMessage = { role: "tool", tool_call_id: call.id, content: toolResultText(result) };
          messages.push(toolMessage); currentTurn.push(toolMessage);
        }
        if (round === MAX_TOOL_ROUNDS - 1) throw new Error(`Agent exceeded the ${MAX_TOOL_ROUNDS} inference rounds for one run.`);
      }
    } finally {
      await runtime.close();
    }
    if (!finalText.trim()) throw new Error("NOverhead Node completed without an assistant text response.");
    const nextTurns = compactPriorTurns(turns);
    await reportUsage(ctx, usage, true);
    await ctx.onLog("stdout", `[paperclip] NOverhead Node inference completed (${toolCallCount} runtime-tool calls).\n`);
    return {
      exitCode: 0, signal: null, timedOut: false, summary: finalText.slice(0, 6000),
      sessionId, sessionDisplayId: sessionId,
      sessionParams: { version: SESSION_VERSION, baseUrl, turns: nextTurns },
      provider: "noverhead_node", biller: "unknown", model: NODE_MODEL, billingType: "unknown", costStatus: "unpriced",
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ...(usage.cachedInputTokens ? { cachedInputTokens: usage.cachedInputTokens } : {}) },
      usageBasis: "per_run", usageComplete: true,
      resultJson: { response: finalText, toolCalls: toolCallCount }, clearSession: false,
    };
  } catch (error) {
    const cancelled = ctx.signal?.aborted || (error instanceof Error && error.name === "AbortError");
    await reportUsage(ctx, usage, false).catch(() => {});
    if (cancelled) {
      return {
        exitCode: null, signal: "SIGTERM", timedOut: false, errorCode: "cancelled", errorFamily: "transient_upstream",
        errorMessage: "NOverhead Node request was cancelled.", sessionId, sessionDisplayId: sessionId,
        sessionParams: { version: SESSION_VERSION, baseUrl, turns: compactPriorTurns(turns) },
        provider: "noverhead_node", biller: "unknown", model: NODE_MODEL, billingType: "unknown", clearSession: false,
      };
    }
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: unknown }).status) : null;
    const timedOut = status === 504;
    const message = error instanceof Error ? error.message : "NOverhead Node request failed.";
    return {
      exitCode: 1, signal: null, timedOut, errorCode: timedOut ? "provider_timeout" : status ? `http_${status}` : "node_request_failed",
      errorFamily: status && status >= 500 ? "transient_upstream" : "configuration", errorMessage: message,
      sessionId, sessionDisplayId: sessionId,
      sessionParams: { version: SESSION_VERSION, baseUrl, turns: compactPriorTurns(turns) },
      provider: "noverhead_node", biller: "unknown", model: NODE_MODEL, billingType: "unknown", clearSession: false,
    };
  }
}

export function createNOverheadNodeAdapter(): ServerAdapterModule {
  return {
    type: "noverhead_node",
    runtimeToolDelivery: "native_mcp",
    supportsToolRefreshOnResume: true,
    supportsInstructionsBundle: true,
    instructionsPathKey: "instructionsFilePath",
    execute,
    models: [{ id: NODE_MODEL, label: "Node configured provider" }],
    listModels: async () => [{ id: NODE_MODEL, label: "Node configured provider" }],
    testEnvironment: async ctx => {
      try {
        const { baseUrl, token } = resolveNodeConfig(ctx.config);
        const models = await fetch(`${baseUrl}/models`, {
          headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), redirect: "error",
        });
        if (!models.ok) throw new Error(`Node model authorization check failed (HTTP ${models.status}).`);
        const inventory = await models.json() as { data?: Array<{ id: string }> };
        if (!inventory.data?.some(model => model.id === "node-default")) throw new Error("Node does not advertise its configured model.");
        const inference = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "node-default", messages: [{ role: "user", content: "Reply with the single word hello." }], max_tokens: 16 }),
          signal: AbortSignal.timeout(180_000), redirect: "error",
        });
        if (!inference.ok) throw new Error(`Node inference check failed (HTTP ${inference.status}).`);
        const completion = await inference.json() as CompletionResponse;
        if (!responseText(completion.choices?.[0]?.message?.content).trim()) throw new Error("Node inference check returned no assistant response.");
        return { adapterType: "noverhead_node", status: "pass", testedAt: new Date().toISOString(), checks: [
          { code: "noverhead_node_authenticated", level: "info", message: "Node authenticated the scoped credential and advertised its configured model." },
          { code: "noverhead_node_inference_passed", level: "info", message: "Node completed an authenticated chat request using its configured model." },
        ] };
      } catch (error) {
        return { adapterType: "noverhead_node", status: "fail", testedAt: new Date().toISOString(), checks: [{
          code: "noverhead_node_connection_failed", level: "error",
          message: error instanceof Error && /^(Use the configured|A resolved|Node |NOverhead Node)/.test(error.message)
            ? error.message : "Could not connect to NOverhead Node. Check its address and bearer grant.",
        }] };
      }
    },
    getConfigSchema: () => ({ fields: [{
      key: "url", label: "NOverhead Node endpoint", type: "text",
      default: process.env.NOVERHEAD_NODE_URL?.trim() || NODE_DEFAULT_URL, required: true,
      hint: "OpenAI-compatible /v1 endpoint for NOverhead Node. The bearer credential is managed separately as a Paperclip secret.",
    }] }),
    agentConfigurationDoc: "# NOverhead Node\nCalls the NOverhead Node OpenAI-compatible chat API directly. Node selects the configured provider and model. Paperclip MCP tools are exposed as model tool calls. Set url to the local Node /v1 endpoint and bind NOVERHEAD_NODE_API_KEY through Paperclip secrets.",
  };
}
