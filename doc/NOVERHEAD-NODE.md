# NOverhead Node onboarding (#261)

The third recommended onboarding source, **NOverhead Node**, is a preset of the
existing Pi agent adapter. Claude and OpenAI keep their existing configuration
and sign-in flows. Node does not require either provider subscription.

## Actual integration boundary

Paperclip agent execution/status → Pi agent loop → OpenAI Chat Completions at
Node → the provider/model configured by Node. Codex is not treated as an LLM
endpoint. The current local deployment uses Ollama. Pi supplies its existing
tools, sessions, Paperclip agent JWT and instruction handling; the preset does
not introduce another agent protocol or execution loop.

`server/src/adapters/noverhead-node.ts` registers `noverhead_node` through the
builtin adapter registry and delegates actual execution to `adapter-pi-local`.
Its only model is `noverhead/node-default`. Node chooses the concrete model;
Paperclip cannot choose an upstream provider URL/model through the request.
Only the local Paperclip execution environment is supported in this increment.

## Configuration and normal onboarding

1. Provision a tenant-bound, expiring Node LocalBearer using the existing
   `noverhead auth local issue` CLI, actor `paperclip-node`, only capability
   `models.chat.completions`, and `--token-file` pointing outside Git to a new
   private file. Select the RuntimeHome belonging to the actual Node instance.
   Preserve all existing credentials; renewal/revocation uses the existing CLI.
2. Configure the Node host's existing `OLLAMA_ENDPOINT` and `OLLAMA_MODEL`.
   Linux Compose exposes its authenticated API internally at port 18766; do not
   publish it publicly just for onboarding.
3. Sign in with the existing Paperclip Owner identity and use the ordinary
   onboarding. Choose **NOverhead Node**, enter its local `/v1` URL (Docker:
   `http://node:18766/v1`) and scoped Node bearer. Supported hosts are `node`,
   `localhost`, `127.0.0.1` and `[::1]`. Credentials in URLs, redirects, query
   strings and remote execution targets are rejected.
4. Paperclip stores the bearer through its existing user-secret APIs and saves
   only the `NOVERHEAD_NODE_API_KEY` secret binding in the agent configuration.
   Raw tokens do not enter the onboarding draft in localStorage.
5. **Connect** checks authenticated `/models`, then runs the existing real Pi
   hello probe through Node. A warning, timeout or authorization failure does
   not complete onboarding. Only a real `pi_hello_probe_passed` result enables
   the normal agent hire and ready screen. No fake connection is accepted.

The custom Pi providers registry contains an environment placeholder, not the
bearer. The existing runtime materializer resolves it server-side into a private
temporary models.json (mode 0600), uses it for the probe/run, then removes it.
The production Docker image installs pinned Pi `@earendil-works/pi-coding-agent`
0.74.0. The Node preset's runtime installer uses the same package/version.

## Verification and limits

The regression tests cover secret bindings, unchanged Claude/OpenAI availability,
the successful ordinary hire path and the denied-probe path. The server tests
cover authenticated discovery, no success on warning/403, cleanup and delegation
to Pi. These tests use controlled responses and are not live E2E evidence.

UI TypeScript and production build, server TypeScript, runner TypeScript build,
and Pi build were checked on Windows. The runner's generated release hashes
require LF bytes; `.gitattributes` preserves those bytes across Windows/Linux
without modifying the committed generated manifests. Production container
build/deployment and authenticated live issue/run results are recorded separately
in #261 and the NOverhead rollout record. Do not infer live acceptance from a
green UI test or model-list response.

An additional regression confirmed that selecting Node must not overwrite the
previous Claude credential-mode choice. Node's bearer-only mode is derived for
that source; returning through the regular Back/source-selection flow restores
the prior subscription or API-key mode and clears the typed Node credential.
The subscription case failed before the correction. After correcting it, UI
TypeScript, the production UI build and all 198 scoped UI tests passed. The test
first attempted a source click during the collapsed phase; it was corrected to
exercise the supported Back transition before isolating the product failure.

The existing Node bearer lifetime is at most 24 hours; renewal is deliberate,
not automatic. Other providers, remote agent environments and federation remain
outside this increment. General architecture/runbook ownership remains in the
existing NOverhead Wiki repository.

## Local production build resources

TypeScript 7 launches a native Go compiler, so the pre-existing `NODE_OPTIONS`
heap setting does not constrain the server compiler. The Docker server build
uses `PAPERCLIP_TSC_MEMORY_LIMIT=2GiB` and `PAPERCLIP_TSC_CPU_LIMIT=2` as defaults,
passed through the standard Go `GOMEMLIMIT` and `GOMAXPROCS` variables for that
build command only. The memory setting is a soft Go GC target, not a container
memory limit. Larger builders can override the Docker build arguments. These
settings do not enter the production runtime.

The Go target alone did not suffice: a controlled compiler run exceeded 5 GiB
resident memory and was stopped. The installed compiler's documented
`--singleThreaded` mode then passed the full server `tsc --noEmit` check with
the same Go settings. The existing server build/typecheck scripts now use that
native mode. Resident memory can still exceed the Go GC target; allow adequate
headroom for other running services.

This follows two local build interruptions with Docker Engine HTTP 500, WSL
connection timeout and a VM near its 8 GiB budget. Task-owned build clients were
stopped and the supported Docker Desktop restart recovered the existing stack.
The precise kernel failure cause was not established; no volume/image reset,
cache pruning or custom database repair was used. Run only one production build
at a time on this host and verify the existing services after recovery.

The first complete server/runtime build then reached provider-pack qualification
and correctly rejected the Pi dependency security patch's bytes. Its Windows
working copy had CRLF (`ccca47aa…`); the unchanged Git blob and LF-normalized
bytes both match the reviewed SHA-256
`5273a195b952f233336122842faaf650193c04f36b9359d20d4d63079b0ce814`.
Root dependency patches now also retain LF through `.gitattributes`. No security
pin, provider profile or patch content was changed. This failure remains part of
the verification record rather than being hidden by a regenerated receipt.
The materializer's existing tests passed 13/13 on Linux. The Windows attempt
passed 10/13; the remaining tests require POSIX path separators, a supported
Linux/Darwin target and symlink permissions. The test source was unchanged.
The ACPX generated-profile/release-attestation check also passed unchanged.

## Authenticated technical client

Use Paperclip's supported Board/browser-approved CLI authentication to the exact
local origin, after Owner authentication. Never copy a token between origins,
alter database role/credential tables, or downgrade authenticated deployment
mode. Board credentials retain their user's permissions and are operator
credentials; do not pass an Owner Board key to the agent. Agent API keys and the
normal per-run JWT remain company/agent scoped. Verify Company, Agent and Issue
access with that actual principal before using the API for an acceptance run.
