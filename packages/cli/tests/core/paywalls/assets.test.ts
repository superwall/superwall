import assert from "node:assert/strict";
import { test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import { ApiError } from "@/core/api/client";
import {
  assetBaseUrl,
  AssetSyncError,
  requireAssets,
  syncAssets,
  uploadFailure,
} from "@/core/paywalls/assets";
import type { BuildAsset } from "@/core/paywalls/assets";

const BASE = "https://user-content.superwalleditor.com/user-content/hl/42";

const asset = (name: string, over: Partial<BuildAsset> = {}): BuildAsset => ({
  fileName: `${name}.png`,
  sha256: name,
  bytes: 1024,
  mime: "image/png",
  path: `/project/superwall/assets/${name}.png`,
  ...over,
});

interface Posted {
  path: string;
  body: unknown;
}

function fakeApi(
  reply: (body: unknown, call: number) => unknown,
  posted: Posted[] = [],
): SuperwallApi {
  let calls = 0;
  const fake = {
    post: async (path: string, body: unknown) => {
      posted.push({ path, body });
      return reply(body, calls++);
    },
  };
  return fake as unknown as SuperwallApi;
}

const hosted = (assets: readonly BuildAsset[], missing: readonly string[] = []) => ({
  assets: assets.map((item) => ({
    sha256: item.sha256,
    url: `${BASE}/${item.fileName}`,
    ...(missing.includes(item.sha256) ? { upload_url: `https://put.test/${item.sha256}` } : {}),
  })),
});

interface Put {
  url: string;
  headers: Record<string, string>;
  bytes: number;
}

const recordingPut = (puts: Put[], ok: (attempt: number) => boolean = () => true) => {
  let attempt = 0;
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init?.headers ?? {})) headers[key] = String(value);
    const body = init?.body;
    puts.push({
      url: String(url),
      headers,
      bytes: body instanceof Uint8Array ? body.byteLength : -1,
    });
    const status = ok(attempt++) ? 200 : 403;
    return { ok: status === 200, status } as Response;
  };
};

test("the base URL is one content-addressed folder per app", () => {
  assert.equal(assetBaseUrl("42"), BASE);
});

test("nothing to sync means no request at all", async () => {
  const posted: Posted[] = [];
  const result = await syncAssets({
    api: fakeApi(() => ({}), posted),
    paywallId: "208540",
    assets: [],
  });

  assert.deepEqual(posted, []);
  assert.deepEqual(result.assets, []);
  assert.equal(result.uploaded, 0);
  assert.equal(result.totalBytes, 0);
});

test("uploads only what the store is missing, and reports the rest as already hosted", async () => {
  const assets = [asset("aaa"), asset("bbb"), asset("ccc")];
  const puts: Put[] = [];

  const result = await syncAssets({
    api: fakeApi(() => hosted(assets, ["bbb"])),
    paywallId: "208540",
    assets,
    put: recordingPut(puts),
    read: () => Buffer.alloc(1024, 7),
  });

  assert.equal(result.uploaded, 1);
  assert.equal(result.uploadedBytes, 1024);
  assert.equal(result.totalBytes, 3072);
  assert.deepEqual(
    puts.map((put) => put.url),
    ["https://put.test/bbb"],
  );
  assert.deepEqual(result.assets, [
    { url: `${BASE}/aaa.png`, mime_type: "image/png" },
    { url: `${BASE}/bbb.png`, mime_type: "image/png" },
    { url: `${BASE}/ccc.png`, mime_type: "image/png" },
  ]);
});

test("the upload carries exactly the two headers the presigned URL was signed with", async () => {
  const assets = [asset("aaa", { mime: "video/mp4", fileName: "aaa.mp4" })];
  const puts: Put[] = [];

  await syncAssets({
    api: fakeApi(() => hosted(assets, ["aaa"])),
    paywallId: "208540",
    assets,
    put: recordingPut(puts),
    read: () => Buffer.alloc(64),
  });

  assert.deepEqual(puts[0]?.headers, {
    "content-type": "video/mp4",
    "cache-control": "public, max-age=31536000, immutable",
  });
  assert.equal(puts[0]?.bytes, 64);
});

test("a rejected upload is retried once, then fails loudly", async () => {
  const assets = [asset("aaa")];
  const once: Put[] = [];
  await syncAssets({
    api: fakeApi(() => hosted(assets, ["aaa"])),
    paywallId: "208540",
    assets,
    put: recordingPut(once, (attempt) => attempt > 0),
    read: () => Buffer.alloc(8),
  });
  assert.equal(once.length, 2);

  const always: Put[] = [];
  await assert.rejects(
    syncAssets({
      api: fakeApi(() => hosted(assets, ["aaa"])),
      paywallId: "208540",
      assets,
      put: recordingPut(always, () => false),
      read: () => Buffer.alloc(8),
    }),
    (error: Error) => error instanceof AssetSyncError && /HTTP 403/.test(error.message),
  );
  assert.equal(always.length, 2);
});

test("a URL that does not match the built file name names superwall.lock", async () => {
  const assets = [asset("aaa")];

  await assert.rejects(
    syncAssets({
      api: fakeApi(() => ({
        assets: [{ sha256: "aaa", url: "https://user-content.test/user-content/hl/99/other.png" }],
      })),
      paywallId: "208540",
      assets,
    }),
    (error: Error) => error instanceof AssetSyncError && /superwall\.lock/.test(error.message),
  );
});

test("a missing entry in the response is a hard failure, never a silent skip", async () => {
  await assert.rejects(
    syncAssets({
      api: fakeApi(() => ({ assets: [] })),
      paywallId: "208540",
      assets: [asset("aaa")],
    }),
    (error: Error) => error instanceof AssetSyncError && /did not return a URL/.test(error.message),
  );
});

test("chunks the manifest so no single call exceeds the endpoint limit", async () => {
  const assets = Array.from({ length: 250 }, (_, index) => asset(`a${index}`));
  const posted: Posted[] = [];

  const result = await syncAssets({
    api: fakeApi((body) => {
      const entries = Reflect.get(Object(body), "assets");
      const list: BuildAsset[] = Array.isArray(entries)
        ? entries.map((entry) => asset(String(Reflect.get(Object(entry), "sha256"))))
        : [];
      return {
        assets: list.map((item) => ({
          sha256: item.sha256,
          url: `${BASE}/${item.sha256}.png`,
        })),
      };
    }, posted),
    paywallId: "208540",
    assets,
  });

  assert.equal(posted.length, 3);
  for (const call of posted) {
    const entries = Reflect.get(Object(call.body), "assets");
    assert.ok(Array.isArray(entries) && entries.length <= 100);
  }
  assert.equal(result.assets.length, 250);
});

test("an environment without the assets endpoint says so instead of 404ing", async () => {
  await assert.rejects(
    syncAssets({
      api: fakeApi(() => {
        throw new ApiError("POST /assets → HTTP 404", 404);
      }),
      paywallId: "208540",
      assets: [asset("aaa")],
    }),
    (error: Error) => error instanceof AssetSyncError && /does not support hosted assets/.test(error.message),
  );
});

test("an upload failure names the file the developer wrote, not its content hash", () => {
  const hero = asset("9f86d081884c7d65", { path: "/project/superwall/assets/hero.mp4" });

  const missing = uploadFailure(hero, { status: 404 });
  assert.match(missing.message, /Couldn't upload hero\.mp4/);
  assert.ok(!missing.message.includes("9f86d081884c7d65"), missing.message);
  assert.match(missing.message, /storage endpoint is misconfigured or unreachable/);

  assert.match(uploadFailure(hero, { status: 403 }).message, /HTTP 403/);
  assert.match(uploadFailure(hero, { status: 500 }).message, /asset store returned HTTP 500/);
});

test("an unreachable asset store says so, and says what to do", () => {
  const hero = asset("aaa", { path: "/project/superwall/assets/hero.mp4" });
  const message = uploadFailure(hero, undefined).message;

  assert.match(message, /Couldn't upload hero\.mp4/);
  assert.match(message, /unreachable/);
  assert.match(message, /push again/);
});

test("an asset with no source path on disk still names something", () => {
  assert.match(
    uploadFailure(asset("aaa", { path: "" }), { status: 500 }).message,
    /Couldn't upload aaa\.png/,
  );
});

test("a framework too old to report assets fails rather than pushing dangling URLs", () => {
  assert.throws(
    () => requireAssets({ snapshotId: "x", html: "", bytes: 0, htmlFile: "x" }),
    (error: Error) => error instanceof AssetSyncError && /update the project's superwall/.test(error.message),
  );
  assert.deepEqual(
    requireAssets({ snapshotId: "x", html: "", bytes: 0, htmlFile: "x", assets: [] }),
    [],
  );
});
