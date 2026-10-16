import assert from "node:assert/strict";
import { test } from "node:test";
import { checkKeyAccess, createPurchaseKey, createTeamKey } from "@/core/apple/keys";
import { AppleError, type AppleSession, type IrisRequest } from "@/core/apple/session";

const PEM = "-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----";

interface Seen {
  method: string;
  path: string;
  request?: IrisRequest;
}

function session(
  reply: (seen: Seen) => unknown,
  issuerId: string | undefined = "issuer-1",
): { session: AppleSession; seen: Seen[] } {
  const seen: Seen[] = [];
  const fake = {
    team: () => ({ id: 1, issuerId, name: "Acme" }),
    iris: async (method: string, path: string, request?: IrisRequest) => {
      const call = { method, path, request };
      seen.push(call);
      return reply(call);
    },
  } as unknown as AppleSession;
  return { session: fake, seen };
}

const keyReply =
  (id: string, privateKey: string | undefined) =>
  ({ method }: Seen) =>
    method === "POST"
      ? { data: { id, attributes: { canDownload: true } } }
      : { data: { id, attributes: { privateKey } } };

test("creates a team key and downloads its private key once", async () => {
  const { session: apple, seen } = session(keyReply("TEAM123456", Buffer.from(PEM).toString("base64")));
  const key = await createTeamKey(apple, { name: "Superwall", role: "APP_MANAGER" });
  assert.deepEqual(key, { id: "TEAM123456", issuerId: "issuer-1", privateKey: `${PEM}\n` });
  assert.deepEqual(seen, [
    {
      method: "POST",
      path: "/apiKeys",
      request: {
        body: {
          data: {
            type: "apiKeys",
            attributes: {
              nickname: "Superwall",
              roles: ["APP_MANAGER"],
              allAppsVisible: true,
              keyType: "PUBLIC_API",
            },
          },
        },
      },
    },
    {
      method: "GET",
      path: "/apiKeys/TEAM123456",
      request: { query: { "fields[apiKeys]": "privateKey" } },
    },
  ]);
});

test("creates an In-App Purchase key through its own resource", async () => {
  const { session: apple, seen } = session(keyReply("IAP1234567", PEM));
  const key = await createPurchaseKey(apple, { name: "Superwall" });
  assert.equal(key.privateKey, `${PEM}\n`);
  assert.deepEqual(seen[0], {
    method: "POST",
    path: "/subscriptionKeys",
    request: { body: { data: { type: "subscriptionKeys", attributes: { nickname: "Superwall" } } } },
  });
  assert.deepEqual(seen[1]?.request, { query: { "fields[subscriptionKeys]": "privateKey" } });
});

test("accepts a private key that arrives base64-encoded and JSON-quoted", async () => {
  const quoted = Buffer.from(JSON.stringify(PEM)).toString("base64");
  const { session: apple } = session(keyReply("K", quoted));
  assert.equal((await createPurchaseKey(apple, { name: "n" })).privateKey, `${PEM}\n`);
});

test("refuses to return something that is not a private key", async () => {
  const { session: apple } = session(keyReply("K", Buffer.from("hello").toString("base64")));
  await assert.rejects(createPurchaseKey(apple, { name: "n" }), /isn't a private key/);
});

test("reports a key Apple created but would not release", async () => {
  const { session: apple } = session(keyReply("LOST123456", undefined));
  await assert.rejects(
    createTeamKey(apple, { name: "n", role: "ADMIN" }),
    /created key LOST123456 but didn't release its private key/,
  );
});

test("reports a create response with no key id", async () => {
  const { session: apple } = session(() => ({ data: {} }));
  await assert.rejects(createPurchaseKey(apple, { name: "n" }), /didn't return its ID/);
});

test("needs the team's issuer before creating anything", async () => {
  const { session: apple, seen } = session(() => ({}), "");
  const withoutIssuer = {
    ...apple,
    team: () => ({ id: 1, name: "Acme" }),
  } as unknown as AppleSession;
  await assert.rejects(
    createTeamKey(withoutIssuer, { name: "n", role: "ADMIN" }),
    (error) => error instanceof AppleError && /issuer/.test(error.message),
  );
  assert.equal(seen.length, 0);
});

test("checks key access with a read-only list call", async () => {
  const { session: apple, seen } = session(() => ({ data: [] }));
  await checkKeyAccess(apple, "team");
  await checkKeyAccess(apple, "purchase");
  assert.deepEqual(
    seen.map((call) => [call.method, call.path, call.request?.query]),
    [
      ["GET", "/apiKeys", { limit: "1" }],
      ["GET", "/subscriptionKeys", { limit: "1" }],
    ],
  );
});
