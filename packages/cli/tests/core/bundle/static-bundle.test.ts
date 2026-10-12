import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  fetchStaticConfig,
  findRemoteAssets,
  selectPaywalls,
  writeBundle,
  type Fetch,
  type StaticConfig,
} from "@/core/bundle/static-bundle";

const DOC = "https://cdn.example.com/doc/onboarding.html?sw_cache_key=1";
const IMAGE = "https://cdn.example.com/hl/1/hero.jpg";
const FONT = "https://cdn.example.com/hl/1/brand.woff2?v=2";

const config: StaticConfig & { build_id: string } = {
  build_id: "build-1",
  paywall_responses: [
    {
      id: 11,
      identifier: "onboarding",
      url: DOC,
      url_config: { endpoints: [{ url: DOC }, { url: "https://mirror.example.com/onboarding.html" }] },
    },
    { id: 12, identifier: "upsell", url: "https://cdn.example.com/doc/upsell.html" },
    { id: 13, identifier: "unused", url: "https://cdn.example.com/doc/unused.html" },
  ],
  trigger_options: [
    {
      event_name: "onboarding",
      rules: [
        {
          variants: [
            { paywall_identifier: "onboarding" },
            { paywall_identifier: null },
          ],
        },
        { variants: [{ paywall_identifier: "upsell" }] },
      ],
    },
  ],
};

const fakeFetch = (bodies: Record<string, { body: string; type?: string; status?: number }>): Fetch & { calls: string[] } => {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const hit = bodies[url];
    if (!hit) return new Response("missing", { status: 404 });
    return new Response(hit.body, {
      status: hit.status ?? 200,
      headers: hit.type ? { "content-type": hit.type } : {},
    });
  }) as Fetch & { calls: string[] };
  impl.calls = calls;
  return impl;
};

test("a placement selects every paywall its rules can show, holdouts aside", () => {
  const selected = selectPaywalls(config, { placements: ["onboarding"], paywalls: [], all: false });
  assert.deepEqual(selected.map((p) => p.identifier), ["onboarding", "upsell"]);
});

test("paywalls select by identifier or id, and --all takes everything", () => {
  assert.deepEqual(
    selectPaywalls(config, { placements: [], paywalls: ["13"], all: false }).map((p) => p.identifier),
    ["unused"],
  );
  assert.equal(selectPaywalls(config, { placements: [], paywalls: [], all: true }).length, 3);
});

test("an unknown placement or paywall names what the app does have", () => {
  assert.throws(
    () => selectPaywalls(config, { placements: ["paywall"], paywalls: [], all: false }),
    /Placements in this app: onboarding/,
  );
  assert.throws(
    () => selectPaywalls(config, { placements: [], paywalls: ["nope"], all: false }),
    /Paywalls in this app: onboarding, upsell, unused/,
  );
  assert.throws(() => selectPaywalls(config, { placements: [], paywalls: [], all: false }), /--placement/);
});

test("remote assets are found in attributes, CSS and script strings, but not page links", () => {
  const html = `
    <img src="${IMAGE}">
    <style>@font-face{src:url(${FONT})}</style>
    <script>const a="${IMAGE}";const t=\`https://cdn.example.com/hl/\${id}.png\`;</script>
    <a href="https://superwall.com/pricing">x</a>
    <img src="https://cdn.example.com/a.png?x=1&amp;y=2">`;
  assert.deepEqual(findRemoteAssets(html).sort(), [
    "https://cdn.example.com/a.png?x=1&y=2",
    IMAGE,
    FONT,
  ].sort());
});

test("the static config is fetched with the public key the SDK uses", async () => {
  let seen: { url: string; headers: Record<string, string> } | undefined;
  const fetchImpl: Fetch = async (url, init) => {
    seen = { url, headers: init?.headers as Record<string, string> };
    return new Response('{"build_id":"b"}', { status: 200 });
  };
  const { raw, config: parsed } = await fetchStaticConfig("pk_test", {
    apiUrl: "https://api.example.com/",
    fetch: fetchImpl,
  });
  assert.equal(seen?.url, "https://api.example.com/api/v1/static_config?pk=pk_test");
  assert.equal(seen?.headers.Authorization, "Bearer pk_test");
  assert.equal(seen?.headers["X-Platform"], "iOS");
  assert.equal(raw, '{"build_id":"b"}');
  assert.equal(parsed.build_id, "b");
});

test("a rejected key fails instead of writing an empty bundle", async () => {
  const fetchImpl: Fetch = async () => new Response("{}", { status: 401 });
  await assert.rejects(
    fetchStaticConfig("pk_bad", { apiUrl: "https://api.example.com", fetch: fetchImpl }),
    /HTTP 401/,
  );
});

test("the bundle holds the raw config, each document, and every asset once", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "sw-bundle-")), "Superwall.bundle");
  const raw = JSON.stringify(config);
  const fetchImpl = fakeFetch({
    [DOC]: { body: `<img src="${IMAGE}"><img src="${IMAGE}">`, type: "text/html; charset=utf-8" },
    "https://cdn.example.com/doc/upsell.html": { body: `<img src="${IMAGE}">`, type: "text/html" },
    [IMAGE]: { body: "jpeg-bytes", type: "binary/octet-stream" },
  });

  const result = await writeBundle({
    out,
    raw,
    config,
    paywalls: selectPaywalls(config, { placements: ["onboarding"], paywalls: [], all: false }),
    fetch: fetchImpl,
    now: () => new Date("2026-10-12T00:00:00Z"),
  });

  assert.equal(fetchImpl.calls.filter((u) => u === IMAGE).length, 1);
  assert.equal(readFileSync(join(out, "static_config.json"), "utf8"), raw);
  const manifest = JSON.parse(readFileSync(join(out, "bundle.json"), "utf8"));
  assert.deepEqual(manifest, result.manifest);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.buildId, "build-1");
  assert.equal(manifest.createdAt, "2026-10-12T00:00:00.000Z");

  const onboarding = result.manifest.paywalls[0]!;
  assert.deepEqual(onboarding.urls, [DOC, "https://mirror.example.com/onboarding.html"]);
  assert.equal(onboarding.document.url, DOC);
  assert.equal(onboarding.document.mimeType, "text/html");
  assert.match(onboarding.document.file, /^files\/[0-9a-f]{64}\.html$/);
  assert.deepEqual(onboarding.resources.map((r) => [r.url, r.mimeType]), [
    [IMAGE, "image/jpeg"],
  ]);
  assert.equal(readFileSync(join(out, onboarding.resources[0]!.file), "utf8"), "jpeg-bytes");
  assert.ok(result.bytes > 0);
});

test("any asset that fails to download fails the bundle and names it", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "sw-bundle-")), "Superwall.bundle");
  const fetchImpl = fakeFetch({ [DOC]: { body: `<img src="${IMAGE}">`, type: "text/html" } });
  await assert.rejects(
    writeBundle({
      out,
      raw: "{}",
      config,
      paywalls: [config.paywall_responses![0]!],
      fetch: fetchImpl,
    }),
    (error: Error) => error.message.includes(`onboarding: HTTP 404 for ${IMAGE}`),
  );
  assert.equal(existsSync(out), false);
});

test("a previous bundle is replaced, but an unrelated directory is never deleted", async () => {
  const root = mkdtempSync(join(tmpdir(), "sw-bundle-"));
  const fetchImpl = fakeFetch({ [DOC]: { body: "<p>hi</p>", type: "text/html" } });
  const paywalls = [config.paywall_responses![0]!];

  const stale = join(root, "Superwall.bundle");
  mkdirSync(join(stale, "files"), { recursive: true });
  writeFileSync(join(stale, "bundle.json"), "{}");
  writeFileSync(join(stale, "files", "stale.png"), "old");
  await writeBundle({ out: stale, raw: "{}", config, paywalls, fetch: fetchImpl });
  assert.equal(existsSync(join(stale, "files", "stale.png")), false);

  const foreign = join(root, "Assets");
  mkdirSync(foreign);
  writeFileSync(join(foreign, "keep.txt"), "mine");
  await assert.rejects(
    writeBundle({ out: foreign, raw: "{}", config, paywalls, fetch: fetchImpl }),
    /is not a Superwall bundle/,
  );
  assert.equal(readFileSync(join(foreign, "keep.txt"), "utf8"), "mine");
});
