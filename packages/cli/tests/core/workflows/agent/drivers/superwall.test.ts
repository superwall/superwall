import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AGENT_SDK_INSTALL_MESSAGE,
  AGENT_SDK_PACKAGE,
  createSdkLoader,
  createSuperwallDriver,
  superwallDriver,
} from "@/core/workflows/agent/drivers/superwall";
import type { AgentEvent, AgentRunOptions } from "@/core/workflows/agent/drivers/index";
import { VERSION } from "@/environment";
import { restoreFetch, useFetch } from "../../../../helpers/fetch";
import { clearHomes, useHome } from "../../../../helpers/home";

type Call = { prompt: string; options: Options };

const signedIn = {
  host: "https://api.example.com",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
};

function hostedStatus(fields: { exhausted: boolean } | null): void {
  useFetch([
    fields === null
      ? { match: "cli-agent/status", status: 503, body: {} }
      : { match: "cli-agent/status", body: { limit: 10, usage: 1, remaining: 9, model: "m", ...fields } },
  ]);
}

function driverYielding(messages: unknown[], calls: Call[] = [], during?: () => void) {
  return createSuperwallDriver(async () =>
    async function* (params) {
      calls.push(params);
      for (const message of messages) {
        during?.();
        yield message as SDKMessage;
      }
    },
  );
}

function runWith(driver: ReturnType<typeof createSuperwallDriver>, extra: Partial<AgentRunOptions> = {}) {
  const events: AgentEvent[] = [];
  const result = driver.run({
    prompt: "integrate",
    cwd: "/tmp/app",
    capabilities: { filesystem: "read", network: true, shell: "read-only" },
    onEvent: (event) => events.push(event),
    ...extra,
  });
  return { result, events };
}

afterEach(() => {
  restoreFetch();
  clearHomes();
});

test("the bundled agent is available when its SDK is installed", async () => {
  assert.deepEqual(await superwallDriver.detect(), {
    id: "superwall",
    displayName: "Superwall Agent",
    bin: "claude-agent-sdk",
  });
});

test("without a browser login the agent refuses before starting", async () => {
  useHome({ apiKey: "sk_key" });
  const calls: Call[] = [];

  const { result, events } = runWith(driverYielding([], calls));

  const message = "Sign in with `superwall login` to use the bundled Superwall Agent.";
  assert.deepEqual(await result, { ok: false, finalText: message, failureReason: undefined });
  assert.deepEqual(events, [{ type: "error", message }]);
  assert.deepEqual(calls, []);
});

test("an unreachable hosted service refuses before starting", async () => {
  useHome(signedIn);
  hostedStatus(null);

  const { result, events } = runWith(driverYielding([]));

  assert.deepEqual(await result, {
    ok: false,
    finalText: "The hosted Superwall Agent is unavailable right now.",
    failureReason: undefined,
  });
  assert.equal(events.length, 1);
});

test("exhausted hosted credit is a usage limit, so another agent can take over", async () => {
  useHome(signedIn);
  hostedStatus({ exhausted: true });

  const { result } = runWith(driverYielding([]));

  assert.deepEqual(await result, {
    ok: false,
    finalText: "Your hosted Superwall Agent credit is exhausted.",
    failureReason: "usage-limit",
  });
});

test("a read-only run goes through the hosted proxy in plan mode and streams its events", async () => {
  useHome(signedIn);
  hostedStatus({ exhausted: false });
  const calls: Call[] = [];
  const driver = driverYielding(
    [
      { type: "system", subtype: "init" },
      { type: "assistant", message: { content: [{ type: "text", text: "[STATUS] Reviewing" }] } },
      { type: "result", subtype: "success", is_error: false, result: "Report" },
    ],
    calls,
  );

  const { result, events } = runWith(driver, { systemAppend: "RULES" });

  assert.deepEqual(await result, { finalText: "Report", ok: true, failureReason: undefined });
  assert.deepEqual(events, [{ type: "status", text: "Reviewing" }]);
  const [call] = calls;
  assert.equal(call?.prompt, "integrate");
  const options = call?.options;
  assert.equal(options?.cwd, "/tmp/app");
  assert.equal(options?.permissionMode, "plan");
  assert.deepEqual(options?.allowedTools, ["Read", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"]);
  assert.deepEqual(options?.disallowedTools, ["Write", "Edit", "MultiEdit", "NotebookEdit"]);
  assert.deepEqual(options?.systemPrompt, { type: "preset", preset: "claude_code", append: "RULES" });
  assert.equal(options?.model, "claude-sonnet-5");
  assert.deepEqual(options?.settingSources, []);
  assert.equal(options?.persistSession, false);
  assert.equal(options?.env?.ANTHROPIC_BASE_URL, "https://api.example.com/v2/cli-agent/anthropic");
  assert.equal(options?.env?.ANTHROPIC_AUTH_TOKEN, "access-token");
  assert.equal(options?.env?.ANTHROPIC_API_KEY, "");
  assert.equal(options?.env?.CLAUDE_CODE_SUBAGENT_MODEL, "claude-sonnet-5");
  assert.equal(options?.env?.CLAUDE_AGENT_SDK_CLIENT_APP, `superwall-cli/${VERSION}`);
  assert.equal(options?.stderr?.("noise from the SDK"), undefined);
  assert.equal(events.length, 1);
});

test("a writable run accepts edits and keeps the stock system prompt", async () => {
  useHome(signedIn);
  hostedStatus({ exhausted: false });
  const calls: Call[] = [];

  const { result } = runWith(driverYielding([{ type: "result", subtype: "success", is_error: false, result: "Done" }], calls), {
    capabilities: { filesystem: "write", network: false, shell: "unrestricted" },
  });

  assert.equal((await result).ok, true);
  assert.equal(calls[0]?.options.permissionMode, "acceptEdits");
  assert.equal(calls[0]?.options.disallowedTools, undefined);
  assert.deepEqual(calls[0]?.options.systemPrompt, { type: "preset", preset: "claude_code" });
});

test("an error result carries its errors, and a limit among them is a usage limit", async () => {
  useHome(signedIn);
  hostedStatus({ exhausted: false });

  const failed = runWith(
    driverYielding([{ type: "result", subtype: "error_during_execution", is_error: true, errors: ["first", "second"] }]),
  );
  assert.deepEqual(await failed.result, { finalText: "first\nsecond", ok: false, failureReason: undefined });

  const limited = runWith(
    driverYielding([{ type: "result", subtype: "error_during_execution", is_error: true, errors: ["You've hit your usage limit"] }]),
  );
  assert.equal((await limited.result).failureReason, "usage-limit");

  const flagged = runWith(driverYielding([{ type: "result", subtype: "success", is_error: true, result: "Partial" }]));
  assert.deepEqual(await flagged.result, { finalText: "Partial", ok: false, failureReason: undefined });
});

test("a result with neither text nor errors has no final text", async () => {
  useHome(signedIn);
  hostedStatus({ exhausted: false });

  const { result } = runWith(driverYielding([{ type: "result", subtype: "error_max_turns", is_error: true }]));

  assert.deepEqual(await result, { finalText: undefined, ok: false, failureReason: undefined });
});

test("a crash is reported as an error, and a limit in it is a usage limit", async () => {
  useHome(signedIn);
  hostedStatus({ exhausted: false });
  const crashing = (thrown: unknown) =>
    createSuperwallDriver(async () =>
      async function* () {
        yield* [];
        throw thrown;
      },
    );

  const crashed = runWith(crashing(new Error("process exited")));
  assert.deepEqual(await crashed.result, { ok: false, finalText: "process exited", failureReason: undefined });
  assert.deepEqual(crashed.events, [{ type: "error", message: "process exited" }]);

  const limited = runWith(crashing("Claude session limit reached"));
  assert.deepEqual(await limited.result, {
    ok: false,
    finalText: "Claude session limit reached",
    failureReason: "usage-limit",
  });
});

test("an already aborted signal aborts the agent with its reason", async () => {
  useHome(signedIn);
  hostedStatus({ exhausted: false });
  const calls: Call[] = [];
  const controller = new AbortController();
  controller.abort("cancelled");

  await runWith(driverYielding([], calls), { signal: controller.signal }).result;

  assert.equal(calls[0]?.options.abortController?.signal.aborted, true);
  assert.equal(calls[0]?.options.abortController?.signal.reason, "cancelled");
});

test("aborting mid-run aborts the agent, and aborting after it ended does not", async () => {
  useHome(signedIn);
  hostedStatus({ exhausted: false });
  const midRun = new AbortController();
  const midCalls: Call[] = [];

  await runWith(
    driverYielding([{ type: "system" }], midCalls, () => midRun.abort("stop")),
    { signal: midRun.signal },
  ).result;
  assert.equal(midCalls[0]?.options.abortController?.signal.reason, "stop");

  const after = new AbortController();
  const afterCalls: Call[] = [];
  await runWith(driverYielding([], afterCalls), { signal: after.signal }).result;
  after.abort("late");
  assert.equal(afterCalls[0]?.options.abortController?.signal.aborted, false);
});

test("without the agent SDK the bundled agent is not detected", async () => {
  const driver = createSuperwallDriver(async () => null);
  assert.equal(await driver.detect(), null);
});

test("running the bundled agent without its SDK says how to install it", async () => {
  useHome(signedIn);
  const { result, events } = runWith(createSuperwallDriver(async () => null));

  assert.deepEqual(await result, { ok: false, finalText: AGENT_SDK_INSTALL_MESSAGE });
  assert.deepEqual(events, [{ type: "error", message: AGENT_SDK_INSTALL_MESSAGE }]);
  assert.match(AGENT_SDK_INSTALL_MESSAGE, /npm install @anthropic-ai\/claude-agent-sdk@\d+\.\d+\.\d+/);
});

function notFound(code = "ERR_MODULE_NOT_FOUND"): Error {
  return Object.assign(new Error("Cannot find package"), { code });
}

test("the loader treats a CommonJS not-found as missing too", async () => {
  const load = createSdkLoader(
    () => os.tmpdir(),
    async () => {
      throw notFound("MODULE_NOT_FOUND");
    },
  );
  assert.equal(await load(), null);
});

test("an SDK that is installed but fails to load is not reported as missing", async () => {
  const load = createSdkLoader(
    () => "/nowhere",
    async () => {
      throw new Error("bad native binary");
    },
  );
  await assert.rejects(load(), /bad native binary/);
});

test("the loader takes the SDK beside the CLI first and loads it once", async () => {
  const query = () => (async function* () {})();
  const asked: string[] = [];
  const load = createSdkLoader(
    () => "/nowhere",
    async (specifier) => {
      asked.push(specifier);
      return { query };
    },
  );

  assert.equal(await load(), query);
  assert.equal(await load(), query);
  assert.deepEqual(asked, [AGENT_SDK_PACKAGE]);
});

test("the loader falls back to the SDK installed in the project", async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "sw-agent-sdk-"));
  const sdkDir = path.join(project, "node_modules", ...AGENT_SDK_PACKAGE.split("/"));
  fs.mkdirSync(sdkDir, { recursive: true });
  fs.writeFileSync(path.join(sdkDir, "package.json"), JSON.stringify({ name: AGENT_SDK_PACKAGE, main: "index.js" }));
  fs.writeFileSync(path.join(sdkDir, "index.js"), "exports.query = function query() {};");
  const asked: string[] = [];
  try {
    const load = createSdkLoader(
      () => project,
      async (specifier) => {
        asked.push(specifier);
        if (specifier === AGENT_SDK_PACKAGE) throw notFound();
        return { query: () => undefined };
      },
    );

    assert.equal(typeof (await load()), "function");
    assert.equal(asked.length, 2);
    assert.ok(asked[1]!.startsWith("file://") && asked[1]!.endsWith("index.js"));
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("the loader answers null when no SDK can be found or it has no query", async () => {
  const missing = createSdkLoader(
    () => os.tmpdir(),
    async () => {
      throw notFound();
    },
  );
  assert.equal(await missing(), null);

  const empty = createSdkLoader(
    () => "/nowhere",
    async () => ({}),
  );
  assert.equal(await empty(), null);
});
