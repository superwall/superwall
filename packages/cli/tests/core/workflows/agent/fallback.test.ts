import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { runFallback } from "@/core/workflows/agent/fallback";
import { SUPPORTED_LABEL } from "@/core/codebase/frameworks";
import { useRenderer } from "@/ui";
import { plainRenderer } from "@/ui/plain/renderer";
import { recordingRenderer, type RendererCall } from "../../../helpers/renderer";

const dirs: string[] = [];

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-fallback-"));
  dirs.push(dir);
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
  return dir;
}

function recording(): RendererCall[] {
  const calls: RendererCall[] = [];
  useRenderer(recordingRenderer(calls));
  return calls;
}

afterEach(() => {
  useRenderer(plainRenderer);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("without an agent the detected app gets the manual steps and how to automate them", async () => {
  const calls = recording();
  const dir = project({ "package.json": JSON.stringify({ dependencies: { expo: "52.0.0" } }), "app.json": "{}" });

  await runFallback(dir);

  assert.deepEqual(
    calls.map((call) => call.method),
    ["info", "note", "note", "outro"],
  );
  assert.equal(calls[0]?.value, "Detected Expo (React Native) · Expo 52.0.0");
  assert.deepEqual(calls[1]?.value, {
    title: "Manual setup",
    value: [
      "1. Install the SDK: expo-superwall",
      "2. Configure Superwall with your public API key at app launch.",
      '3. Register one placement: register("campaign_trigger").',
      "",
      "Full guide: https://superwall.com/docs/expo",
    ].join("\n"),
  });
  assert.match(String((calls[2]?.value as { value: string }).value), /npm install --global @anthropic-ai\/claude-code/);
  assert.equal(calls[3]?.value, "Re-run `superwall integrate` after installing an agent.");
});

test("an app without details is named alone", async () => {
  const calls = recording();
  const dir = project({ "pubspec.yaml": "name: acme\ndependencies:\n  flutter:\n    sdk: flutter\n" });

  await runFallback(dir);

  assert.equal(calls[0]?.value, "Detected Flutter");
});

test("a web-only project is refused as unsupported", async () => {
  recording();
  const dir = project({ "package.json": JSON.stringify({ dependencies: { next: "14.0.0", "react-dom": "18" } }) });

  await assert.rejects(runFallback(dir), /^Error: Detected a web app\. This command supports mobile apps\.$/);
});

test("a directory with no app names the frameworks it looked for", async () => {
  const calls = recording();

  await assert.rejects(runFallback(project({})), new Error(`No ${SUPPORTED_LABEL} app found here.`));
  assert.deepEqual(calls, []);
});
