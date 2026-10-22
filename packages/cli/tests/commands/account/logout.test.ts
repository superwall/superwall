import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command as logout } from "@/commands/account/logout";
import { restoreFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { runCommand } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  delete process.env.SUPERWALL_API_HOST;
  process.exitCode = undefined;
});

const sessionFile = (home: string) => path.join(home, "auth.json");

test("logout forgets the session and says whose it was", async () => {
  const home = useHome({ userEmail: "dev@example.com" });

  const result = await runCommand(logout);

  assert.equal(fs.existsSync(sessionFile(home)), false);
  assert.match(result.said("success").join(), /Logged out \(dev@example\.com\)/);
});

test("logout asks first when someone is watching, and honours a no", async () => {
  const home = useHome({ userEmail: "dev@example.com" });
  const calls: { method: string; value?: unknown }[] = [];
  const renderer = {
    ...(await import("../../helpers/renderer")).recordingRenderer(calls),
    confirm: async () => false,
  };

  await runCommand(logout, { interactive: true, renderer });

  assert.equal(fs.existsSync(sessionFile(home)), true);
  assert.match(
    calls
      .filter((call) => call.method === "outro")
      .map((call) => String(call.value))
      .join(),
    /Staying logged in/,
  );
});

test("logout with nobody logged in says so instead of pretending", async () => {
  useHome();

  const result = await runCommand(logout);

  assert.match(result.said("error").join(), /aren't logged in yet/);
});

test("logout --json reports what it did without asking", async () => {
  const home = useHome({ userEmail: "dev@example.com" });

  const result = await runCommand(logout, { json: true, interactive: true });

  assert.equal(fs.existsSync(sessionFile(home)), false);
  assert.equal((result.json as { loggedOut: boolean }).loggedOut, true);

  useHome();
  const empty = await runCommand(logout, { json: true });
  assert.deepEqual(empty.json, { loggedOut: false, account: null });
});
