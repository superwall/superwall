import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Arguments } from "yargs";
import { defineCommand, executeCommand } from "@/command";
import { NotLoggedInError } from "@/core/auth/errors";
import type { SuperwallApi } from "@/core/api/client";
import { recordingRenderer } from "./helpers/renderer";

const argv = (values: Record<string, unknown> = {}): Arguments => ({
  _: [],
  $0: "superwall",
  ...values,
});

afterEach(() => {
  process.exitCode = undefined;
});

test("command definitions expose centralized policy metadata", () => {
  const command = defineCommand({
    name: "products",
    auth: "required",
    interaction: "none",
    output: "both",
    run: () => {},
  });

  assert.deepEqual(command.definition, {
    name: "products",
    auth: "required",
    interaction: "none",
    output: "both",
    run: command.definition.run,
  });
});

test("the kernel injects authentication before running a required command", async () => {
  const api = {} as SuperwallApi;
  let received: SuperwallApi | undefined;
  const definition = {
    name: "products",
    auth: "required" as const,
    run: (ctx: { api: SuperwallApi }) => {
      received = ctx.api;
    },
  };

  await executeCommand(definition, argv(), {
    api: () => api,
    nonInteractive: true,
    renderer: () => recordingRenderer(),
    waitForPaint: false,
  });

  assert.equal(received, api);
});

test("JSON errors use one stable machine-readable schema", async () => {
  let stdout = "";
  let ran = false;

  await executeCommand(
    {
      name: "products",
      auth: "required",
      output: "both",
      run: () => {
        ran = true;
      },
    },
    argv({ json: true }),
    {
      api: () => {
        throw new NotLoggedInError();
      },
      nonInteractive: false,
      renderer: () => recordingRenderer(),
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        },
      },
      waitForPaint: false,
    },
  );

  assert.equal(ran, false);
  assert.deepEqual(JSON.parse(stdout), {
    error: {
      code: "not_logged_in",
      message: "You aren't logged in. Run `superwall login` first.",
    },
  });
  assert.match(stdout, /^\{\n  "error"/);
  assert.equal(process.exitCode, 1);
});

test("--no-interactive disables prompts without changing the renderer", async () => {
  const states: Array<{ mode: string; interactive: boolean }> = [];
  const definition = {
    name: "test",
    run: (ctx: { outputMode: string; interactive: boolean }) => {
      states.push({ mode: ctx.outputMode, interactive: ctx.interactive });
    },
  };
  const runtime = {
    nonInteractive: false,
    renderer: () => recordingRenderer(),
    waitForPaint: false,
  };

  await executeCommand(definition, argv({ interactive: false }), runtime);
  await executeCommand({ ...definition, output: "both" as const }, argv({ json: true }), runtime);
  await executeCommand({ ...definition, interaction: "none" as const }, argv(), runtime);
  await executeCommand(definition, argv(), {
    ...runtime,
    nonInteractive: true,
  });

  assert.deepEqual(states, [
    { mode: "rich", interactive: false },
    { mode: "json", interactive: false },
    { mode: "rich", interactive: false },
    { mode: "text", interactive: false },
  ]);
});

test("unsupported --json requests fail before command execution", async () => {
  let stdout = "";
  let ran = false;

  await executeCommand(
    {
      name: "integrate",
      run: () => {
        ran = true;
      },
    },
    argv({ json: true }),
    {
      nonInteractive: false,
      renderer: () => recordingRenderer(),
      stdout: {
        write: (value) => {
          stdout += String(value);
          return true;
        },
      },
      waitForPaint: false,
    },
  );

  assert.equal(ran, false);
  assert.deepEqual(JSON.parse(stdout), {
    error: {
      code: "json_not_supported",
      message: "integrate does not support --json.",
    },
  });
  assert.equal(process.exitCode, 1);
});

test("optional authentication is absent instead of blocking the command", async () => {
  let apiWasPresent = true;
  await executeCommand(
    {
      name: "doctor",
      auth: "optional",
      run: (context) => {
        apiWasPresent = context.api !== undefined;
      },
    },
    argv(),
    {
      api: () => {
        throw new NotLoggedInError();
      },
      nonInteractive: true,
      renderer: () => recordingRenderer(),
      waitForPaint: false,
    },
  );

  assert.equal(apiWasPresent, false);
  assert.equal(process.exitCode, undefined);
});
