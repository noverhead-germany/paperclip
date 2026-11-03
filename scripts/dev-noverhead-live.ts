import { stdin, stdout } from "node:process";
import { execute, NODE_KEY } from "../server/src/adapters/noverhead-node.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

const input = JSON.parse(await readStdin()) as { token?: unknown; prompt?: unknown };
if (typeof input.token !== "string" || input.token.length < 32) {
  throw new Error("Provide a valid Node credential through stdin.");
}
const prompt = typeof input.prompt === "string" && input.prompt.trim()
  ? input.prompt.trim()
  : "Reply only with paperclip-e2e-ok";
const logs: string[] = [];
const usage: unknown[] = [];
const result = await execute({
  runId: `dev-live-${Date.now()}`,
  agent: { id: "dev-live-agent", companyId: "dev-live-company", name: "Node live probe", adapterType: "noverhead_node", adapterConfig: {} },
  runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
  config: {
    url: "http://127.0.0.1:18767/v1",
    env: { [NODE_KEY]: input.token },
    promptTemplate: "{{context.prompt}}",
  },
  context: { prompt },
  onLog: async (stream: string, message: string) => { logs.push(`${stream}: ${message.trim()}`); },
  onUsage: async (record: unknown) => { usage.push(record); },
});

stdout.write(`${JSON.stringify({
  exitCode: result.exitCode,
  timedOut: result.timedOut,
  errorCode: result.errorCode,
  response: result.summary,
  provider: result.provider,
  model: result.model,
  usage: result.usage,
  logs,
  usageRecords: usage,
})}\n`);
if (result.exitCode !== 0) process.exitCode = 1;
