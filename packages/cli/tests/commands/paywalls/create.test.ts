import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { executeCommand } from "@/command";
import { alreadyAProject, runCreate } from "@/commands/paywalls/create";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

function scratch(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`));
}

async function create(argv: Record<string, unknown>, calls: RendererCall[] = []) {
  const before = process.exitCode;
  await executeCommand(runCreate.definition, { _: [], $0: "superwall", ...argv }, {
    renderer: () => recordingRenderer(calls),
    nonInteractive: true,
    waitForPaint: false,
  });
  const failed =
    process.exitCode !== undefined && process.exitCode !== 0 && process.exitCode !== before;
  process.exitCode = before;
  return { calls, failed };
}

test("create scaffolds superwall/ inside the app root, named after the app", async () => {
  const root = path.join(scratch("create"), "my-app");
  fs.mkdirSync(root);
  const { calls, failed } = await create({ dir: root, install: false, connect: false });

  assert.equal(failed, false);
  assert.ok(fs.existsSync(path.join(root, "superwall", "paywalls", "pro", "config.ts")));
  const parsed = JSON.parse(
    fs.readFileSync(path.join(root, "superwall", "package.json"), "utf8"),
  );
  assert.equal(parsed.name, "my-app");
  const list = calls.find((call) => call.method === "list");
  const labels = (list?.value as { items: Array<{ label: string }> }).items.map(
    (item) => item.label,
  );
  assert.match(labels[0] ?? "", /^cd superwall && /);
  assert.ok(labels.some((label) => label === "superwall integrate"));
});

test("an app that already has a superwall/ directory is refused", async () => {
  const root = scratch("existing");
  fs.mkdirSync(path.join(root, "superwall"));
  fs.writeFileSync(path.join(root, "superwall", "package.json"), "{}");
  const { calls, failed } = await create({ dir: root, install: false, connect: false });

  assert.equal(failed, true);
  assert.match(String(calls.find((call) => call.method === "error")?.value), /superwall dev/);
});

test("a bare superwall project root is recognized by its markers", () => {
  const bare = scratch("bare");
  fs.writeFileSync(path.join(bare, "superwall.lock"), "{}");
  assert.match(alreadyAProject(bare) ?? "", /already a superwall project/);

  const byDep = scratch("dep");
  fs.writeFileSync(
    path.join(byDep, "package.json"),
    JSON.stringify({ dependencies: { superwall: "latest" } }),
  );
  assert.match(alreadyAProject(byDep) ?? "", /already a superwall project/);
});

test("an empty superwall/ directory does not block setup", () => {
  const root = scratch("fresh");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  fs.mkdirSync(path.join(root, "superwall"));

  assert.equal(alreadyAProject(root), undefined);
});
