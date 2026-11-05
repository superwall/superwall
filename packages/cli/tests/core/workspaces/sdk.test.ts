import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, latestVersion, vendoredVersion, warnIfSdkBehind } from "@/core/workspaces/sdk";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { workspaceProject, writeVendoredSdk } from "./fixture";

const answering = (version: unknown, ok = true) => async () => ({ ok, json: async () => ({ version }) });

async function warnings(root: string, fetchImpl: Parameters<typeof warnIfSdkBehind>[2]): Promise<string[]> {
  const calls: RendererCall[] = [];
  await warnIfSdkBehind(recordingRenderer(calls), root, fetchImpl);
  return calls.filter((call) => call.method === "warn").map((call) => String(call.value));
}

test("behind: says so and names the command", async () => {
  const root = workspaceProject();
  writeVendoredSdk(root, "0.1.0");
  const [warning] = await warnings(root, answering("0.2.0"));
  assert.match(warning!, /0\.1\.0.*0\.2\.0.*superwall workspaces update/);
  assert.equal((await warnings(root, answering("1.0.0"))).length, 1);
  assert.equal((await warnings(root, answering("0.1.1-beta.1"))).length, 1);
});

test("versions compare by semver, prereleases included", () => {
  const ascending = ["0.1.0", "0.2.0-alpha", "0.2.0-alpha.1", "0.2.0-beta.1", "0.2.0-beta.2", "0.2.0-beta.11", "0.2.0-rc", "0.2.0", "0.2.1", "1.0.0"];
  for (let index = 0; index < ascending.length - 1; index += 1) {
    const [lower, higher] = [ascending[index]!, ascending[index + 1]!];
    assert.ok(compareVersions(lower, higher) < 0, `${lower} < ${higher}`);
    assert.ok(compareVersions(higher, lower) > 0, `${higher} > ${lower}`);
  }
  assert.equal(compareVersions("1.0.0+build", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-1", "1.0.0-1"), 0);
  assert.ok(compareVersions("1.0.0-1", "1.0.0-a") < 0);
});

test("a beta behind the next beta or its stable release says so", async () => {
  const root = workspaceProject();
  writeVendoredSdk(root, "0.2.0-beta.1");
  assert.equal((await warnings(root, answering("0.2.0-beta.2"))).length, 1);
  assert.equal((await warnings(root, answering("0.2.0"))).length, 1);
  assert.equal((await warnings(root, answering("0.1.9"))).length, 0);
});

test("current or ahead: says nothing", async () => {
  const root = workspaceProject();
  writeVendoredSdk(root, "0.2.0");
  assert.deepEqual(await warnings(root, answering("0.2.0")), []);
  assert.deepEqual(await warnings(root, answering("0.1.9")), []);
});

test("an unreachable check never blocks or complains", async () => {
  const root = workspaceProject();
  writeVendoredSdk(root, "0.1.0");
  assert.deepEqual(await warnings(root, async () => { throw new Error("offline"); }), []);
  assert.deepEqual(await warnings(root, answering("9.9.9", false)), []);
  assert.deepEqual(await warnings(root, answering(7)), []);
});

test("no vendored package: says how to add it, without asking the network", async () => {
  const root = workspaceProject();
  const [warning] = await warnings(root, async () => { throw new Error("should not be called"); });
  assert.match(warning!, /no vendored SDK package/);
  assert.equal(vendoredVersion(root), undefined);
});

test("latestVersion reads the public repo's starter", async () => {
  let url = "";
  const version = await latestVersion(async (requested) => {
    url = requested;
    return { ok: true, json: async () => ({ version: "1.2.3" }) };
  });
  assert.equal(version, "1.2.3");
  assert.match(url, /raw\.githubusercontent\.com\/superwall\/superwall\/main\/workspaces\/starter\/vendor\/workspace-sdk\/package\.json/);
});
