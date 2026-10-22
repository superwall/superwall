import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAccount } from "@/core/account";
import { recordingRenderer } from "../../helpers/renderer";

const existing = {
  sdkInstalled: false,
  configureFound: false,
  registerCalls: [],
  fullyIntegrated: false,
};

test("noninteractive account resolution never invents an API key", async () => {
  const previous = process.env.SUPERWALL_API_KEY;
  delete process.env.SUPERWALL_API_KEY;
  try {
    await assert.rejects(
      resolveAccount({
        existing,
        apiKey: undefined,
        interactive: false,
        ui: recordingRenderer(),
      }),
      /No public API key found/,
    );
  } finally {
    if (previous === undefined) delete process.env.SUPERWALL_API_KEY;
    else process.env.SUPERWALL_API_KEY = previous;
  }
});

test("noninteractive account resolution accepts explicit and existing keys", async () => {
  const explicit = await resolveAccount({
    existing,
    apiKey: "pk_explicit",
    interactive: false,
    ui: recordingRenderer(),
  });
  const project = await resolveAccount({
    existing: { ...existing, apiKey: "pk_project" },
    apiKey: undefined,
    interactive: false,
    ui: recordingRenderer(),
  });

  assert.equal(explicit?.apiKey, "pk_explicit");
  assert.equal(project?.apiKey, "pk_project");
});

test("interactive resolution never prompts for a key - it points back to login", async () => {
  const previous = process.env.SUPERWALL_API_KEY;
  delete process.env.SUPERWALL_API_KEY;
  const ui = recordingRenderer();
  let prompted = false;
  ui.text = async () => {
    prompted = true;
    return "pk_prompted";
  };

  try {
    await assert.rejects(
      resolveAccount({
        existing,
        apiKey: undefined,
        interactive: true,
        ui,
      }),
      /complete the browser login/,
    );
    assert.equal(prompted, false);
  } finally {
    if (previous === undefined) delete process.env.SUPERWALL_API_KEY;
    else process.env.SUPERWALL_API_KEY = previous;
  }
});

test("an interactive run asks before reusing a key that differs from the one passed in", async () => {
  const asked: unknown[] = [];
  const answering = (answer: boolean | null) => {
    const ui = recordingRenderer();
    ui.confirm = async (value) => (asked.push(value), answer);
    return ui;
  };
  const withProjectKey = { ...existing, apiKey: "pk_project" };

  const reused = await resolveAccount({ existing: withProjectKey, apiKey: "pk_flag", interactive: true, ui: answering(true) });
  const declined = await resolveAccount({ existing: withProjectKey, apiKey: "pk_flag", interactive: true, ui: answering(false) });
  const cancelled = await resolveAccount({ existing: withProjectKey, apiKey: "pk_flag", interactive: true, ui: answering(null) });

  assert.deepEqual(reused, { apiKey: "pk_project" });
  assert.deepEqual(declined, { apiKey: "pk_flag" });
  assert.equal(cancelled, null);
  assert.deepEqual(asked[0], {
    message: "This project already has a Superwall key (pk_project). Use this app?",
  });
});

test("an interactive run reuses the project's key without asking when it is the one passed in", async () => {
  const ui = recordingRenderer();
  ui.confirm = async () => {
    throw new Error("must not ask");
  };

  const result = await resolveAccount({
    existing: { ...existing, apiKey: "pk_project" },
    apiKey: "pk_project",
    interactive: true,
    ui,
  });

  assert.deepEqual(result, { apiKey: "pk_project" });
});

test("SUPERWALL_API_KEY is the org's secret key, never taken for the app's public key", async () => {
  const previous = process.env.SUPERWALL_API_KEY;
  process.env.SUPERWALL_API_KEY = "sk_live_secret";
  try {
    await assert.rejects(
      resolveAccount({ existing, apiKey: undefined, interactive: false, ui: recordingRenderer() }),
      /No public API key found\. Pass --api-key\./,
    );
  } finally {
    if (previous === undefined) delete process.env.SUPERWALL_API_KEY;
    else process.env.SUPERWALL_API_KEY = previous;
  }
});
