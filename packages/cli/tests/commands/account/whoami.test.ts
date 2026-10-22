import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as whoami } from "@/commands/account/whoami";
import { restoreFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { runCommand } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  delete process.env.SUPERWALL_API_HOST;
  process.exitCode = undefined;
});

test("whoami names the account, the credential and the host it talks to", async () => {
  useHome({ userEmail: "dev@example.com", orgName: "Solo Inc", apiKey: "sk_live_abcd" });

  const result = await runCommand(whoami);

  const [list] = result.calls.filter((call) => call.method === "list");
  const items = (list?.value as { items: { label: string; children: { label: string }[] }[] })
    .items;
  assert.equal(items[0]?.label, "dev@example.com");
  assert.match(String(items[0]?.children[0]?.label), /API key sk_…abcd/);
});

test("whoami says which credential kind is in play", async () => {
  useHome({ accessToken: "at_1", userEmail: "oauth@example.com" });
  const oauth = await runCommand(whoami);
  const items = (
    oauth.calls.find((c) => c.method === "list")?.value as {
      items: { children: { label: string }[] }[];
    }
  ).items;
  assert.equal(items[0]?.children[0]?.label, "OAuth session");

  useHome({ userEmail: "bare@example.com" });
  const neither = await runCommand(whoami);
  const bare = (
    neither.calls.find((c) => c.method === "list")?.value as {
      items: { children: { label: string }[] }[];
    }
  ).items;
  assert.equal(bare[0]?.children[0]?.label, " - ");
});

test("whoami with no session says how to sign in", async () => {
  useHome();

  const result = await runCommand(whoami);

  assert.match(result.said("error").join(), /aren't logged in/);
});

test("whoami --json reports the account as data, logged in or not", async () => {
  useHome({ userEmail: "dev@example.com", orgName: "Solo Inc", apiKey: "sk_live_x" });

  const loggedIn = await runCommand(whoami, { json: true });

  assert.deepEqual(loggedIn.json, {
    authenticated: true,
    user: { email: "dev@example.com" },
    credential: { type: "api_key" },
    host: "https://api.example.com",
  });

  useHome();
  const loggedOut = await runCommand(whoami, { json: true });
  assert.deepEqual(loggedOut.json, { authenticated: false });
});

test("whoami shows an API key's organization, never a browser login's stale one", async () => {
  const metaOf = (result: Awaited<ReturnType<typeof runCommand>>) =>
    (result.calls.find((c) => c.method === "list")?.value as { items: { meta?: string }[] })
      .items[0]?.meta;

  useHome({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    userEmail: "ci@example.com",
    orgName: "Solo Inc",
  });
  assert.equal(metaOf(await runCommand(whoami)), "· Solo Inc");

  useHome({
    authMethod: "oauth",
    accessToken: "at_1",
    userEmail: "me@example.com",
    orgName: "Demo Inc",
  });
  assert.equal(metaOf(await runCommand(whoami)), undefined);
});
