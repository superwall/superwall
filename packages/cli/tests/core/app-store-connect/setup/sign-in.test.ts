import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as setupApple } from "@/commands/app-store-connect/setup/apple";
import { createAppleSession, type PendingVerification } from "@/core/app-store-connect/apple-web/session";
import { fakeApple, fixedRandom, jsonResponse, vector, type FakeAppleOptions } from "../../../helpers/apple";
import { PENDING, fakeApi, scenario, useAppleDeps } from "../../../helpers/apple-setup";
import { runCommand } from "../../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

interface TextPrompt {
  message: string;
  validate?: (value: string) => string | undefined;
}

async function againstApple(
  apple: FakeAppleOptions,
  input: { flags?: Record<string, unknown>; json?: boolean; interactive?: boolean; text?: string[] },
) {
  const fake = fakeApple(apple);
  const { api } = fakeApi();
  const calls: RendererCall[] = [];
  const answers = [...(input.text ?? [])];
  const saved: PendingVerification[] = [];
  const renderer = {
    ...recordingRenderer(calls),
    text: async (value: unknown) => (calls.push({ method: "text", value }), answers.shift() ?? null),
    select: async (value: unknown) => (calls.push({ method: "select", value }), "8"),
  };
  const restore = useAppleDeps({
    session: (options) => createAppleSession({ fetch: fake.fetch, random: fixedRandom, ...options }),
    credentials: () => ({ appleId: vector.accountName, password: vector.password }),
    pending: { load: () => undefined, save: (pending) => saved.push(pending), clear: () => {} },
    sleep: async () => {},
    writeKeyFile: (name) => `/tmp/${name}`,
  });
  try {
    const result = await runCommand(setupApple, {
      flags: input.flags,
      json: input.json,
      interactive: input.interactive ?? false,
      api,
      renderer,
    });
    return {
      result,
      fake,
      saved,
      said: (method: string) => calls.filter((call) => call.method === method).map((call) => String(call.value)),
    };
  } finally {
    restore();
  }
}

test("the sign-in prompts require an email and a password, which may be spaces", async () => {
  const run = await scenario(setupApple, {
    interactive: true,
    credentials: {},
    apple: { twoFactor: true },
    answers: { select: ["8"], text: ["jane@example.com", "hunter2", "123456"] },
  });

  const asked = run.calls.filter((call) => call.method === "text").map((call) => call.value as TextPrompt);
  assert.deepEqual(
    asked.map((prompt) => prompt.message),
    ["Apple Account email", "Apple Account password", "Verification code"],
  );
  assert.equal(asked[0]?.validate?.("  "), "Required");
  assert.equal(asked[0]?.validate?.("jane@example.com"), undefined);
  assert.equal(asked[1]?.validate?.(""), "Required");
  assert.equal(asked[1]?.validate?.("   "), undefined);
  assert.equal(asked[2]?.validate?.(" "), "Required");
  assert.equal(asked[2]?.validate?.("123456"), undefined);
  assert.deepEqual(run.said("success"), ["Apple is connected for `Acme`."]);
});

test("a voice call to an unlisted number is described plainly when the run stops for the code", async () => {
  const phones = [{ id: 1, pushMode: "voice", numberWithDialCode: "" }];

  const human = await againstApple({ noTrustedDevices: true, phones }, {});
  assert.match(human.said("warn")[0] ?? "", /^Apple is calling your trusted phone number\.\nRun `superwall setup apple --code <code>`/);
  assert.equal(human.fake.called("PUT", "/verify/phone").length, 0);
  assert.equal(human.saved.length, 1);
  assert.equal(process.exitCode, 1);

  const json = await againstApple({ noTrustedDevices: true, phones }, { json: true });
  assert.deepEqual(json.result.json, {
    status: "verification_required",
    method: "voice",
    destination: null,
    next: "superwall setup apple --code <code>",
  });
});

test("--phone continues a saved sign-in and asks Apple for a new code", async () => {
  const run = await scenario(setupApple, {
    stored: PENDING,
    flags: { phone: "+1 555 0142" },
    json: true,
  });

  assert.deepEqual(run.sessions, [PENDING]);
  assert.deepEqual(run.log, ["requestCode device"]);
  assert.equal((run.result.json as { status: string }).status, "verification_required");
  assert.deepEqual(run.pending(), PENDING);
});

test("a failure after the code is accepted is reported once, not retried as a wrong code", async () => {
  const run = await againstApple(
    {
      routes: (call) =>
        call.method === "GET" && call.url.endsWith("/olympus/v1/session")
          ? jsonResponse({ errors: [{ detail: "Service unavailable" }] }, { status: 503 })
          : undefined,
    },
    { interactive: true, text: ["123456", "123456"] },
  );

  assert.deepEqual(run.said("error"), ["App Store Connect didn't accept the sign-in: Service unavailable"]);
  assert.deepEqual(run.said("warn"), []);
  assert.equal(run.fake.called("POST", "/securitycode").length, 1);
  assert.equal(run.saved.length, 0);
});
