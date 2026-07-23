import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { test } from "node:test";
import { resolveAppBinding } from "@/core/account/bind";
import type { SuperwallApi } from "@/core/api/client";
import { selectRenderer } from "@/ui";
import { getState, reset } from "@/ui/ink/store";

test("an empty project offers app creation with the detected name prefilled", async () => {
  reset();
  selectRenderer({ mode: "rich" });
  const api = {
    list: async () => [{ id: "project_1", name: "Monoroll", applications: [] }],
  } as unknown as SuperwallApi;

  const result = resolveAppBinding(api, {
    platform: "ios",
    appName: "Monoroll",
    bundleId: "com.example.monoroll",
  });
  await waitForImmediate();

  let active = getState().active;
  assert.equal(active?.type, "select");
  if (active?.type !== "select") return;
  assert.equal(active.message, "Which Superwall project?");
  active.resolve("project_1");
  await waitForImmediate();

  active = getState().active;
  assert.equal(active?.type, "select");
  if (active?.type !== "select") return;
  assert.equal(active.message, "No apps in `Monoroll` yet.");
  assert.deepEqual(active.options, [
    {
      value: "__new__",
      label: "＋ Create a new iOS app",
      hint: "Monoroll",
    },
  ]);
  active.resolve("__new__");
  await waitForImmediate();

  active = getState().active;
  assert.equal(active?.type, "text");
  if (active?.type !== "text") return;
  assert.equal(active.value, "Monoroll");
  active.resolve(null);
  await waitForImmediate();

  active = getState().active;
  if (active?.type !== "select") return;
  active.resolve(null);
  await waitForImmediate();

  active = getState().active;
  if (active?.type !== "select") return;
  active.resolve(null);
  assert.equal(await result, null);
  reset();
  selectRenderer({ mode: "text" });
});
