import assert from "node:assert/strict";
import { test } from "node:test";
import { environmentLines } from "@/core/app-store-connect/notification-url";
import { OURS, environment, outcome } from "../../helpers/apple-setup";

test("each environment names who holds it, with the URL only when it isn't ours or empty", () => {
  const lines = environmentLines(
    outcome("conflict", {
      production: environment("other", null),
      sandbox: environment("superwall_app", OURS, { id: 12, name: "Other App" }),
    }),
  );

  assert.deepEqual(lines, [
    "Production: another server",
    `Sandbox: another Superwall app, Other App (app 12)  ${OURS}`,
  ]);
  assert.deepEqual(environmentLines(outcome("set", { production: environment("this_app") })), [
    "Production: this app's Superwall URL",
  ]);
});
