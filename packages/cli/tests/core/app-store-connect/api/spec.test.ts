import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  type AscIndex,
  downloadAscIndex,
  forgetCachedIndex,
  indexIsStale,
  readCachedIndex,
  writeCachedIndex,
} from "@/core/app-store-connect/api/spec";
import { startAscRefresh } from "@/hosts/terminal";
import { buildZip, serveZip } from "../../../helpers/asc-spec";
import { restoreFetch } from "../../../helpers/fetch";
import { clearHomes, useHome } from "../../../helpers/home";

const SPEC_URL =
  "https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip";

const APPLE_SPEC = {
  openapi: "3.0.1",
  info: { version: 4.1 },
  components: {
    schemas: {
      Platform: { type: "string", enum: ["IOS", "MAC_OS"] },
      Name: { type: "string" },
      CreateRequest: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["subscriptions"] },
              attributes: { $ref: "#/components/schemas/CreateAttributes" },
              relationships: {
                type: "object",
                required: ["group"],
                properties: {
                  group: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: { type: { type: "string", enum: ["subscriptionGroups"] }, id: { type: "string" } },
                      },
                    },
                  },
                  prices: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/PriceIdentifier" },
                      },
                    },
                  },
                  owner: { type: "object", properties: { data: { type: "object", properties: {} } } },
                },
              },
            },
          },
        },
      },
      CreateAttributes: {
        type: "object",
        required: ["name"],
        properties: {
          name: { $ref: "#/components/schemas/Name" },
          platform: { $ref: "#/components/schemas/Platform" },
          metadata: {},
        },
      },
      PriceIdentifier: {
        type: "object",
        properties: { type: { $ref: "#/components/schemas/PriceType" } },
      },
      PriceType: { type: "string", enum: ["subscriptionPrices"] },
      LimitParam: { name: "limit", in: "query" },
    },
  },
  paths: {
    "/v1/subscriptions": {
      post: {
        operationId: "subscriptions_create",
        summary: "Create a subscription",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/CreateRequest" } } } },
      },
      get: {
        operationId: "subscriptions_list",
        deprecated: true,
        parameters: [
          { $ref: "#/components/schemas/LimitParam" },
          { name: "fields[subscriptions]", in: "query" },
          { name: "id", in: "path" },
        ],
      },
    },
    "/v1/bare": {
      post: {
        operationId: "bare_create",
        requestBody: {
          content: {
            "application/json": {
              schema: { properties: { data: { properties: { type: { enum: ["bares"] }, attributes: { type: "object" } } } } },
            },
          },
        },
      },
    },
    "/v1/link": {
      post: {
        operationId: "link_create",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  data: {
                    properties: {
                      type: { enum: ["links"] },
                      relationships: { properties: { app: { properties: { data: { properties: { type: { enum: ["apps"] } } } } } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/subscriptions/{id}": {
      delete: { operationId: "subscriptions_delete" },
      patch: {
        operationId: "subscriptions_update",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  data: { properties: { attributes: { properties: { name: { type: "string" } } }, relationships: { type: "object" } } },
                },
              },
            },
          },
        },
      },
      parameters: [],
    },
  },
};

afterEach(() => {
  restoreFetch();
  clearHomes();
  forgetCachedIndex();
});

const sample: AscIndex = { specVersion: "4.0", openapi: "3.0.1", paths: { "/v1/apps": { get: { opId: "apps_list" } } } };

test("readCachedIndex reads the index from the Superwall home and then answers from memory", () => {
  const home = useHome();
  const file = join(home, "asc-index.json");
  writeFileSync(file, JSON.stringify(sample));
  assert.deepEqual(readCachedIndex(), sample);
  unlinkSync(file);
  assert.deepEqual(readCachedIndex(), sample);
});

test("writeCachedIndex stores the index in the Superwall home and replaces the in-memory index", () => {
  const home = useHome();
  const next: AscIndex = { ...sample, specVersion: "4.1", fetchedAt: 1 };
  writeCachedIndex(next);
  assert.deepEqual(JSON.parse(readFileSync(join(home, "asc-index.json"), "utf8")), next);
  assert.deepEqual(readdirSync(home), ["asc-index.json"]);
  assert.equal(readCachedIndex(), next);
});

test("readCachedIndex asks for a refresh when there is no schema yet", () => {
  useHome();
  assert.throws(() => readCachedIndex(), /Run `superwall asc docs --refresh`/);
});

test("indexIsStale treats a missing or week-old fetch time as stale", () => {
  assert.equal(indexIsStale(sample), true);
  assert.equal(indexIsStale({ ...sample, fetchedAt: Date.now() - 60_000 }), false);
  assert.equal(indexIsStale({ ...sample, fetchedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }), true);
});

test("downloadAscIndex unzips Apple's spec and derives operations, fields, relationships and query params", async () => {
  const zip = buildZip(
    [
      { name: "README.txt", data: Buffer.from("hello"), extra: 4 },
      { name: "openapi.oas.json", data: Buffer.from(JSON.stringify(APPLE_SPEC)), deflate: true },
    ],
    { comment: 5 },
  );
  const urls = serveZip(zip);
  const before = Date.now();
  const index = await downloadAscIndex();
  assert.deepEqual(urls, [SPEC_URL]);
  assert.ok(index.fetchedAt !== undefined && index.fetchedAt >= before);
  assert.equal(index.specVersion, "4.1");
  assert.equal(index.openapi, "3.0.1");
  assert.deepEqual(index.paths, {
    "/v1/subscriptions": {
      get: {
        opId: "subscriptions_list",
        summary: undefined,
        deprecated: true,
        query: ["limit", "fields[subscriptions]"],
      },
      post: {
        opId: "subscriptions_create",
        summary: "Create a subscription",
        dataType: "subscriptions",
        attributes: {
          name: { required: true, type: "string" },
          platform: { required: false, enum: ["IOS", "MAC_OS"] },
          metadata: { required: false },
        },
        relationships: {
          group: { required: true, many: false, target: "subscriptionGroups" },
          prices: { required: false, many: true, target: "subscriptionPrices" },
          owner: { required: false, many: false },
        },
      },
    },
    "/v1/bare": { post: { opId: "bare_create", summary: undefined, dataType: "bares" } },
    "/v1/link": {
      post: {
        opId: "link_create",
        summary: undefined,
        dataType: "links",
        relationships: { app: { required: false, many: false, target: "apps" } },
      },
    },
    "/v1/subscriptions/{id}": {
      patch: { opId: "subscriptions_update", summary: undefined, attributes: { name: { required: false, type: "string" } } },
      delete: { opId: "subscriptions_delete", summary: undefined },
    },
  });
});

test("downloadAscIndex reads a stored entry and defaults a spec without version info", async () => {
  serveZip(buildZip([{ name: "spec.json", data: Buffer.from(JSON.stringify({ paths: {} })) }]));
  const index = await downloadAscIndex();
  assert.equal(index.specVersion, "unknown");
  assert.equal(index.openapi, "unknown");
  assert.deepEqual(index.paths, {});
  serveZip(buildZip([{ name: "spec.json", data: Buffer.from("{}") }]));
  assert.deepEqual((await downloadAscIndex()).paths, {});
});

test("downloadAscIndex reports an HTTP failure", async () => {
  serveZip(Buffer.alloc(0), 503);
  await assert.rejects(downloadAscIndex(), {
    message: "Couldn't fetch the App Store Connect schema (HTTP 503). Check your connection and retry.",
  });
});

test("downloadAscIndex refuses archives it can't read", async () => {
  serveZip(Buffer.from("not a zip archive at all, just text"));
  await assert.rejects(downloadAscIndex(), { message: "App Store Connect spec: no zip directory found." });
  serveZip(buildZip([{ name: "spec.json", data: Buffer.from("{}") }], { badDirectory: true }));
  await assert.rejects(downloadAscIndex(), { message: "App Store Connect spec: malformed zip directory." });
  serveZip(buildZip([{ name: "spec.yaml", data: Buffer.from("openapi: 3") }]));
  await assert.rejects(downloadAscIndex(), { message: "App Store Connect spec: no JSON entry in archive." });
});

function fakeSpawn(calls: { cmd: string; args: readonly string[]; options: Record<string, unknown> }[]) {
  let unrefs = 0;
  const impl = ((cmd: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ cmd, args, options });
    return Object.assign(new EventEmitter(), { unref: () => void unrefs++ });
  }) as unknown as typeof spawn;
  return { impl, unrefs: () => unrefs };
}

test("startAscRefresh starts a detached refresh of the schema through the current entry point", () => {
  const calls: { cmd: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
  const spawn = fakeSpawn(calls);
  startAscRefresh(spawn.impl);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.cmd, process.execPath);
  assert.deepEqual(call.args, [process.argv[1], "asc", "docs", "--refresh", "--quiet"]);
  assert.equal(call.options.detached, true);
  assert.equal(call.options.stdio, "ignore");
  assert.equal((call.options.env as NodeJS.ProcessEnv).SW_ASC_REFRESH, "1");
  assert.equal(spawn.unrefs(), 1);
});

test("startAscRefresh does nothing inside a refresh or without an entry point", () => {
  const calls: { cmd: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
  const spawn = fakeSpawn(calls);
  process.env.SW_ASC_REFRESH = "1";
  try {
    startAscRefresh(spawn.impl);
  } finally {
    delete process.env.SW_ASC_REFRESH;
  }
  const entry = process.argv[1];
  process.argv[1] = "";
  try {
    startAscRefresh(spawn.impl);
  } finally {
    process.argv[1] = entry ?? "";
  }
  assert.equal(calls.length, 0);
});

test("startAscRefresh swallows a spawn failure", () => {
  const failing = (() => {
    throw new Error("EAGAIN");
  }) as unknown as typeof spawn;
  assert.doesNotThrow(() => startAscRefresh(failing));
});
