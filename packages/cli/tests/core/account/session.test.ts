import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runLogout, runWhoami } from "@/core/account/session";
import { readSession } from "@/core/account/storage";
import type { CommandContext } from "@/program/command";
import { createCommandOutput } from "@/program/output";
import type { Renderer } from "@/ui";
import { clearHomes, useHome } from "../../helpers/home";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

afterEach(() => {
  clearHomes();
});

function contextFor(
  renderer: Renderer,
  { json = false, interactive = false } = {},
): { ctx: CommandContext<"none">; stdout: () => string } {
  let written = "";
  const stdout = {
    write: (value: string | Uint8Array) => {
      written += String(value);
      return true;
    },
  };
  return {
    ctx: {
      ui: renderer,
      output: createCommandOutput(json ? "json" : "text", renderer, { stdout }),
      outputMode: json ? "json" : "text",
      interactive,
      installDir: process.cwd(),
      json,
      dryRun: false,
      target: {},
      fail: () => {
        process.exitCode = 1;
      },
    },
    stdout: () => written,
  };
}

const said = (calls: RendererCall[], method: string) =>
  calls.filter((call) => call.method === method).map((call) => call.value);

test("whoami without an email or organization still shows the credential and host", () => {
  useHome({ accessToken: "at_1", host: "https://api.example.com" });
  const calls: RendererCall[] = [];

  runWhoami(contextFor(recordingRenderer(calls)).ctx);

  assert.deepEqual(said(calls, "list"), [
    {
      items: [
        {
          label: "Logged in",
          meta: undefined,
          children: [{ label: "OAuth session", meta: "https://api.example.com" }],
        },
      ],
    },
  ]);
});

test("logout without an email asks plainly and says it logged out", async () => {
  useHome({ apiKey: "sk_1" });
  const calls: RendererCall[] = [];
  const renderer: Renderer = {
    ...recordingRenderer(calls),
    confirm: async (value) => (calls.push({ method: "confirm", value }), true),
  };

  await runLogout(contextFor(renderer, { interactive: true }).ctx);

  assert.deepEqual(said(calls, "confirm"), [{ message: "Log out of Superwall?" }]);
  assert.deepEqual(said(calls, "success"), ["Logged out."]);
  assert.equal(readSession(), null);
});

test("an interactive logout that is confirmed names whose session it was", async () => {
  useHome({ apiKey: "sk_1", userEmail: "dev@example.com" });
  const calls: RendererCall[] = [];
  const renderer: Renderer = {
    ...recordingRenderer(calls),
    confirm: async (value) => (calls.push({ method: "confirm", value }), true),
  };

  await runLogout(contextFor(renderer, { interactive: true }).ctx);

  assert.deepEqual(said(calls, "confirm"), [{ message: "Log out of Superwall (`dev@example.com`)?" }]);
  assert.deepEqual(said(calls, "success"), ["Logged out (dev@example.com)."]);
});

test("logout --json reports the account it forgot", async () => {
  useHome({ apiKey: "sk_1", userEmail: "dev@example.com", host: "https://api.example.com" });
  const { ctx, stdout } = contextFor(recordingRenderer(), { json: true });

  await runLogout(ctx);

  assert.deepEqual(JSON.parse(stdout()), {
    loggedOut: true,
    account: {
      authenticated: true,
      user: { email: "dev@example.com" },
      credential: { type: "api_key" },
      host: "https://api.example.com",
    },
  });
  assert.equal(readSession(), null);
});
