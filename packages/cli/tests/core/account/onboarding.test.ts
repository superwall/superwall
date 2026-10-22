import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { onboardingHooks } from "@/core/account/onboarding";
import type { DetectedApp } from "@/core/codebase/scan";
import { readOnboardedApp } from "@/core/state/config";
import { Integration } from "@/environment";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import type { TextOpts } from "@/ui/types";
import { clearHomes, useHome } from "../../helpers/home";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

afterEach(() => {
  clearHomes();
  selectRenderer({ mode: "text" });
});

function detected(integration: Integration): DetectedApp {
  return {
    path: "/work/monoroll",
    relPath: "monoroll",
    name: "Monoroll",
    framework: { integration, name: "Swift (iOS)", supported: true, sdkPackage: "", docsUrl: "" },
    integration,
    score: 1,
  };
}

const asked: TextOpts[] = [];

function answering(answers: { confirm?: Array<boolean | null>; text?: Array<string | null> }): RendererCall[] {
  const calls: RendererCall[] = [];
  asked.length = 0;
  useRenderer({
    ...recordingRenderer(calls),
    confirm: async (value) => (calls.push({ method: "confirm", value }), answers.confirm?.shift() ?? null),
    text: async (value) => (asked.push(value), answers.text?.shift() ?? null),
  });
  return calls;
}

const said = (calls: RendererCall[], method: string) =>
  calls.filter((call) => call.method === method).map((call) => call.value);

test("a detected app is offered as the first app and names the organization by default", async () => {
  const calls = answering({ confirm: [true], text: ["  Monoroll Inc  "] });

  const setup = await onboardingHooks(detected(Integration.swift)).onOnboard();

  assert.deepEqual(setup, { orgName: "Monoroll Inc", app: { name: "Monoroll", platform: "ios" } });
  assert.deepEqual(said(calls, "info"), ["Welcome to Superwall! Let's get `Monoroll` set up."]);
  assert.deepEqual(said(calls, "confirm"), [{ message: "Create `Monoroll` as your first app?" }]);
  assert.equal(asked[0]?.message, "What's your organization called?");
  assert.equal(asked[0]?.initialValue, "Monoroll");
  assert.equal(asked[0]?.validate?.("  "), "Required");
  assert.equal(asked[0]?.validate?.("Acme"), undefined);
});

test("android and web apps are offered on their own platforms", async () => {
  answering({ confirm: [true, true], text: ["Acme", "Acme"] });

  assert.deepEqual((await onboardingHooks(detected(Integration.android)).onOnboard())?.app, {
    name: "Monoroll",
    platform: "android",
  });
  assert.deepEqual((await onboardingHooks(detected(Integration.web)).onOnboard())?.app, {
    name: "Monoroll",
    platform: "web",
  });
});

test("declining the detected app creates only the organization", async () => {
  answering({ confirm: [false], text: ["Acme"] });

  assert.deepEqual(await onboardingHooks(detected(Integration.swift)).onOnboard(), {
    orgName: "Acme",
    app: undefined,
  });
});

test("an app the onboarding can't provision, or no app at all, only asks for the organization", async () => {
  const calls = answering({ text: ["Acme", "Solo"] });

  assert.deepEqual(await onboardingHooks(detected(Integration.flutter)).onOnboard(), {
    orgName: "Acme",
    app: undefined,
  });
  assert.deepEqual(await onboardingHooks().onOnboard(), { orgName: "Solo", app: undefined });
  assert.deepEqual(said(calls, "confirm"), []);
  assert.equal(asked[1]?.initialValue, undefined);
  assert.deepEqual(said(calls, "info"), [
    "Welcome to Superwall! Let's set up your account.",
    "Welcome to Superwall! Let's set up your account.",
  ]);
});

test("escaping either question cancels onboarding", async () => {
  answering({ confirm: [null] });
  assert.equal(await onboardingHooks(detected(Integration.swift)).onOnboard(), null);

  answering({ confirm: [true], text: [null] });
  assert.equal(await onboardingHooks(detected(Integration.swift)).onOnboard(), null);
});

test("a provisioned key is remembered for the detected app's directory", () => {
  useHome();
  const hooks = onboardingHooks(detected(Integration.swift));
  assert.equal(hooks.provisioned(), null);

  hooks.onProvisioned({ publicApiKey: "pk_1", projectId: "5", applicationId: "55", orgId: "9" });

  assert.deepEqual(hooks.provisioned(), {
    publicApiKey: "pk_1",
    projectId: "5",
    applicationId: "55",
    orgId: "9",
  });
  assert.deepEqual(readOnboardedApp("/work/monoroll"), {
    publicApiKey: "pk_1",
    projectId: "5",
    applicationId: "55",
  });
});

test("a provision without a key, or without a detected app, remembers nothing on disk", () => {
  useHome();

  const keyless = onboardingHooks(detected(Integration.swift));
  keyless.onProvisioned({ projectId: "5" });
  const appless = onboardingHooks();
  appless.onProvisioned({ publicApiKey: "pk_1" });

  assert.deepEqual(keyless.provisioned(), { projectId: "5" });
  assert.deepEqual(appless.provisioned(), { publicApiKey: "pk_1" });
  assert.equal(readOnboardedApp("/work/monoroll"), undefined);
});
