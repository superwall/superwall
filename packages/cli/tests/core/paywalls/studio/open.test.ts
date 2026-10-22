import assert from "node:assert/strict";
import * as fs from "node:fs";
import { afterEach, test } from "node:test";
import { askStudio, migrationNextSteps, screenNextSteps, startStudio } from "@/core/paywalls/studio/open";
import { useRenderer } from "@/ui";
import { selectRenderer } from "@/ui/select";
import { writeFakeFrameworkProject } from "../../../helpers/framework";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

const dirs: string[] = [];

afterEach(() => {
  selectRenderer({ mode: "text" });
  Reflect.deleteProperty(globalThis, "__superwallPreview");
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("the studio is never offered without someone at the terminal", async () => {
  const calls: RendererCall[] = [];
  assert.equal(await askStudio(recordingRenderer(calls), false, "force-update"), false);
  assert.equal(calls.length, 0);
});

test("declining the offer is a no", async () => {
  const calls: RendererCall[] = [];
  assert.equal(await askStudio(recordingRenderer(calls), true, "force-update"), false);
  const confirm = calls.find((call) => call.method === "confirm");
  assert.match(String((confirm?.value as { message: string }).message), /paywall\/force-update next to the original/);
});

test("the next steps follow the answers: studio opening, or how to open it; tweaks before pushing", () => {
  const opening = migrationNextSteps(true, "superwall", "255456", "agent");
  assert.equal(opening.length, 3);
  assert.match(opening[0] ?? "", /opens on the rebuilt paywall with the original beside it/);
  assert.match(opening[1] ?? "", /ask your agent to tweak/);
  assert.match(opening[2] ?? "", /^Push when it's right/);

  const later = migrationNextSteps(false, ".", "255456", "later");
  assert.equal(later.length, 4);
  assert.match(later[0] ?? "", /^superwall migrate 255456/);
  assert.match(later[1] ?? "", /Run `superwall dev` in \.,.*Compare › Original/);

  const copied = migrationNextSteps(false, "superwall", "255456", "copy");
  assert.equal(copied.length, 3);
  assert.match(copied[0] ?? "", /superwall dev` in superwall/);
});

test("a screen without a captured original is offered the studio without the compare pane", async () => {
  const calls: RendererCall[] = [];
  await askStudio(recordingRenderer(calls), true, "update-required", false);
  const confirm = calls.find((call) => call.method === "confirm");
  assert.equal(String((confirm?.value as { message: string }).message), "Open the studio now, on paywall/update-required?");
});

test("screen next steps follow the screenshot, the studio answer, and end with wiring the app", () => {
  const base = {
    superwallDir: "superwall",
    screenPath: "App/UpdateRequiredView.swift",
    placement: "update_required",
  };
  const shot = screenNextSteps({ ...base, studioOpening: true, screenshot: true, choice: "agent" });
  assert.equal(shot.length, 3);
  assert.match(shot[0] ?? "", /with the simulator screenshot beside it/);
  assert.match(shot[2] ?? "", /register\("update_required"\) where it presented App\/UpdateRequiredView.swift/);
  assert.match(shot[2] ?? "", /delete the native screen/);

  const noShot = screenNextSteps({ ...base, studioOpening: true, screenshot: false, choice: "agent" });
  assert.match(noShot[0] ?? "", /Keep the original open in the simulator/);

  const later = screenNextSteps({ ...base, studioOpening: false, screenshot: true, choice: "later" });
  assert.equal(later.length, 4);
  assert.match(later[0] ?? "", /^superwall migrate --screen App\/UpdateRequiredView.swift/);
  assert.match(later[1] ?? "", /Compare › Original shows the simulator screenshot/);

  const copied = screenNextSteps({ ...base, studioOpening: false, screenshot: false, choice: "copy" });
  assert.equal(copied.length, 3);
  assert.match(copied[0] ?? "", /next to the original running in the simulator/);
});

test("starting the studio after a migration serves the project and opens the rebuilt paywall", async () => {
  const root = writeFakeFrameworkProject();
  dirs.push(root);
  useRenderer(recordingRenderer());
  const opened: string[] = [];
  const openBrowser = async (url: string) => (opened.push(url), true);

  await startStudio(root, "pro", true, { openBrowser });
  const preview: { roots: string[]; options: { port: number; host: string } } = Reflect.get(
    globalThis,
    "__superwallPreview",
  );
  await startStudio(root, "pro", false, { openBrowser });

  assert.deepEqual(preview.roots, [root]);
  assert.equal(preview.options.port, 6100);
  assert.equal(preview.options.host, "0.0.0.0");
  assert.deepEqual(opened, [
    "http://localhost:6101/paywall/pro?compare=origin",
    "http://localhost:6101/paywall/pro",
  ]);
});
