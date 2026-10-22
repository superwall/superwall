import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command } from "@/commands/paywalls/promote";
import type { SuperwallApi } from "@/core/api/client";
import { promotePaywallVersion } from "@/core/api/resources";
import { runCommand } from "../../helpers/command";

const apiKey = process.env.SUPERWALL_API_KEY;

afterEach(() => {
  if (apiKey === undefined) delete process.env.SUPERWALL_API_KEY;
  else process.env.SUPERWALL_API_KEY = apiKey;
  process.exitCode = 0;
});

test("promote without a login stops before touching the project, and says how to log in", async () => {
  delete process.env.SUPERWALL_API_KEY;

  const result = await runCommand(command, { args: { dir: "/nonexistent" }, flags: { version: 3 } });

  assert.match(result.said("error")[0] ?? "", /Pushing paywalls needs a Superwall account/);
  assert.equal(process.exitCode, 1);
});

test("--version is a number, and -v is its short form", () => {
  assert.equal(command.flags.version?.alias, "v");
  assert.throws(() => command.validate({ flags: { version: "three" } }), /--version takes a number/);
});

interface Posted {
  path: string;
  body: unknown;
}

function fakeApi(posted: Posted[], reply: unknown = { version: 3, url: "u" }): SuperwallApi {
  const fake = {
    post: async (path: string, body: unknown) => {
      posted.push({ path, body });
      return reply;
    },
  };
  return fake as unknown as SuperwallApi;
}

test("promote with no version asks for the latest, sending no version at all", async () => {
  const posted: Posted[] = [];
  await promotePaywallVersion(fakeApi(posted), "208540");

  assert.deepEqual(posted, [{ path: "/v2/paywalls/208540/promote", body: {} }]);
});

test("an older version than the one live is passed through verbatim — this is rollback", async () => {
  const posted: Posted[] = [];
  const promoted = await promotePaywallVersion(fakeApi(posted, { version: 3, url: "u" }), "208540", {
    version: 3,
  });

  assert.deepEqual(posted, [{ path: "/v2/paywalls/208540/promote", body: { version: 3 } }]);
  assert.equal(promoted.version, 3);
});

test("version 0 is still sent — it is a number, not an absent value", async () => {
  const posted: Posted[] = [];
  await promotePaywallVersion(fakeApi(posted), "208540", { version: 0 });

  assert.deepEqual(posted[0]?.body, { version: 0 });
});

test("the paywall id is escaped into the path", async () => {
  const posted: Posted[] = [];
  await promotePaywallVersion(fakeApi(posted), "a/b c");

  assert.equal(posted[0]?.path, "/v2/paywalls/a%2Fb%20c/promote");
});
