import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { defineCommand, type CommandContext, type RawInput } from "@/program/command";
import { errorAside, normalizeError } from "@/program/lifecycle";
import { NotLoggedInError } from "@/core/account/errors";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { recordingRenderer } from "../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

const quiet = { renderer: () => recordingRenderer(), waitForPaint: false };

function capture() {
  let text = "";
  return {
    stdout: {
      write: (value: string | Uint8Array) => {
        text += String(value);
        return true;
      },
    },
    text: () => text,
  };
}

const probe = (spec: { auth?: "none" | "optional" | "required"; json?: boolean; prompts?: boolean } = {}) => {
  const seen: { ctx?: CommandContext; input?: unknown } = {};
  const command = defineCommand({
    name: "probe",
    summary: "A probe",
    args: {
      id: { describe: "An id", required: true },
      rest: { describe: "The rest", variadic: true },
    },
    flags: {
      count: { type: "number", describe: "A count" },
      level: { type: "string", choices: ["low", "high"], default: "low", describe: "A level" },
      tag: { type: "list", describe: "Tags" },
      force: { type: "boolean", describe: "Force" },
      app: { type: "string", describe: "The app" },
      dryRun: { type: "boolean", describe: "Plan only" },
    },
    examples: [["probe 1", "Probe one"]],
    auth: spec.auth ?? "none",
    json: spec.json ?? true,
    prompts: spec.prompts ?? true,
    mcp: "read",
    run: (ctx, input) => {
      seen.ctx = ctx;
      seen.input = input;
    },
  });
  return { command, seen };
};

test("the lifecycle injects authentication before running a required command", async () => {
  const api = {} as SuperwallApi;
  const { command, seen } = probe({ auth: "required" });
  await command.execute({ args: { id: "1" } }, { ...quiet, api: () => api, nonInteractive: true });
  assert.equal(seen.ctx?.api, api);
});

test("JSON errors use one stable machine-readable schema", async () => {
  const out = capture();
  const { command, seen } = probe({ auth: "required" });
  await command.execute(
    { args: { id: "1" }, json: true },
    {
      ...quiet,
      api: () => {
        throw new NotLoggedInError();
      },
      stdout: out.stdout,
    },
  );
  assert.equal(seen.ctx, undefined);
  assert.deepEqual(JSON.parse(out.text()), {
    error: { code: "not_logged_in", message: "You aren't logged in. Run `superwall login` first." },
  });
  assert.match(out.text(), /^\{\n  "error"/);
  assert.equal(process.exitCode, 1);
});

test("--no-interactive disables prompts without changing the renderer", async () => {
  const states: { mode: string; interactive: boolean }[] = [];
  const record = async (spec: Parameters<typeof probe>[0], input: RawInput, nonInteractive = false) => {
    const { command, seen } = probe(spec);
    await command.execute({ args: { id: "1" }, ...input }, { ...quiet, nonInteractive });
    if (seen.ctx) states.push({ mode: seen.ctx.outputMode, interactive: seen.ctx.interactive });
  };
  await record({}, { interactive: false });
  await record({}, { json: true });
  await record({ prompts: false }, {});
  await record({}, {}, true);
  assert.deepEqual(states, [
    { mode: "rich", interactive: false },
    { mode: "json", interactive: false },
    { mode: "rich", interactive: false },
    { mode: "text", interactive: false },
  ]);
});

test("unsupported --json requests fail before command execution", async () => {
  const out = capture();
  const { command, seen } = probe({ json: false });
  await command.execute({ args: { id: "1" }, json: true }, { ...quiet, stdout: out.stdout });
  assert.equal(seen.ctx, undefined);
  assert.deepEqual(JSON.parse(out.text()), {
    error: { code: "json_not_supported", message: "probe does not support --json." },
  });
  assert.equal(process.exitCode, 1);
});

test("Ctrl-C stops the renderer, says it was cancelled, and exits 130", async () => {
  let interrupt: (() => void) | undefined;
  const renderer = { ...recordingRenderer(), onInterrupt: (listener: () => void) => ((interrupt = listener), () => {}) };
  const { command } = probe();
  await command.execute({ args: { id: "1" } }, { renderer: () => renderer, waitForPaint: false });
  let stderr = "";
  mock.method(process.stderr, "write", (value: unknown) => ((stderr += String(value)), true));
  const exit = mock.method(process, "exit", () => undefined as never);
  interrupt?.();
  mock.restoreAll();
  assert.equal(stderr, "\n✗ Cancelled.\n");
  assert.deepEqual(exit.mock.calls[0]?.arguments, [130]);
});

test("a rich run waits a frame for the renderer to paint before it stops", async () => {
  const { command, seen } = probe();
  const started = Date.now();
  await command.execute({ args: { id: "1" } }, { renderer: () => recordingRenderer(), nonInteractive: false });
  assert.equal(seen.ctx?.outputMode, "rich");
  assert.ok(Date.now() - started >= 40);
});

test("optional authentication is absent instead of blocking the command", async () => {
  const { command, seen } = probe({ auth: "optional" });
  await command.execute(
    { args: { id: "1" } },
    {
      ...quiet,
      api: () => {
        throw new NotLoggedInError();
      },
      nonInteractive: true,
    },
  );
  assert.ok(seen.ctx);
  assert.equal(seen.ctx.api, undefined);
  assert.equal(process.exitCode, undefined);
});

const plain = (text: string): string => stripVTControlCharacters(text);

const envelope = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "invalid_request_error",
    code: "resource_missing",
    message: "No such pushed paywall version: '11111'",
    doc_url: "https://superwall.com/docs/errors/resource-missing",
    resource_type: "pushed paywall version",
    resource_id: "11111",
    _tag: "@superwall/api-schema/v2/errors/ResourceMissing",
    ...over,
  });

test("the headline is the API's message, never the request or the raw body", () => {
  const error = new ApiError("POST /v2/paywalls/208540/promote", 404, envelope());

  assert.equal(normalizeError(error).message, "No such pushed paywall version: '11111'");
  assert.equal(normalizeError(error).code, "api_error");
  assert.equal(normalizeError(error).status, 404);
});

test("doc_url rides along as a dim aside; the internal fields never render", () => {
  const error = new ApiError("POST /v2/paywalls/208540/promote", 404, envelope());
  const aside = errorAside(error).map(plain);

  assert.deepEqual(aside, ["https://superwall.com/docs/errors/resource-missing"]);
  assert.ok(!aside.join("\n").includes("_tag"));
  assert.ok(!aside.join("\n").includes("POST /v2"));
});

test("a hint leads the aside, above the doc url", () => {
  const error = new ApiError("POST /v2/paywalls/208540/promote", 404, envelope());
  error.hint = "Run `superwall promote` without --version to promote the latest.";

  assert.deepEqual(errorAside(error).map(plain), [
    "Run `superwall promote` without --version to promote the latest.",
    "https://superwall.com/docs/errors/resource-missing",
  ]);
});

test("only an unrecognized body earns the request line, where it aids debugging", () => {
  const opaque = new ApiError("GET /v2/paywalls/208540", 502, "<html>Bad Gateway</html>");

  assert.match(normalizeError(opaque).message, /^HTTP 502 — /);
  assert.deepEqual(errorAside(opaque).map(plain), ["GET /v2/paywalls/208540"]);
});

test("non-API errors render their own message with no aside", () => {
  assert.equal(normalizeError(new Error("Not a superwall project: /tmp/x")).message, "Not a superwall project: /tmp/x");
  assert.equal(normalizeError(new Error("x")).code, "command_error");
  assert.deepEqual(errorAside(new Error("x")), []);
  assert.equal(normalizeError(new NotLoggedInError()).code, "not_logged_in");
  assert.match(normalizeError(new NotLoggedInError()).message, /superwall login/);
});
