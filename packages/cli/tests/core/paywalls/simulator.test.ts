import assert from "node:assert/strict";
import { test } from "node:test";
import { askForScreenshot, createSimulator, type SimulatorRuntime } from "@/core/paywalls/simulator";
import type { Renderer } from "@/ui";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

const confirming = (calls: RendererCall[], answer: boolean | null): Renderer => ({
  ...recordingRenderer(calls),
  confirm: async (options) => {
    calls.push({ method: "confirm", value: options });
    return answer;
  },
});

const runtime = (booted: boolean, file: string | undefined): SimulatorRuntime => ({
  booted: async () => (booted ? { udid: "ABC", name: "iPhone 17 Pro" } : undefined),
  screenshot: async (udid) => (udid === "ABC" ? file : undefined),
});

test("no booted simulator means no question", async () => {
  const calls: RendererCall[] = [];
  assert.equal(await askForScreenshot(confirming(calls, true), runtime(false, "/tmp/x.png")), undefined);
  assert.equal(calls.length, 0);
});

test("declining the capture leaves no screenshot", async () => {
  const calls: RendererCall[] = [];
  assert.equal(await askForScreenshot(confirming(calls, false), runtime(true, "/tmp/x.png")), undefined);
  const confirm = calls.find((call) => call.method === "confirm")?.value as { message: string };
  assert.match(confirm.message, /Capture `iPhone 17 Pro` as the original\? Show the screen in the simulator first/);
  assert.equal(calls.some((call) => call.method === "step"), false);
});

test("a capture returns the file and says which device it came from", async () => {
  const calls: RendererCall[] = [];
  assert.equal(await askForScreenshot(confirming(calls, true), runtime(true, "/tmp/x.png")), "/tmp/x.png");
  assert.match(String(calls.find((call) => call.method === "step")?.value), /Captured `iPhone 17 Pro`/);
});

test("a failed capture warns and moves on", async () => {
  const calls: RendererCall[] = [];
  assert.equal(await askForScreenshot(confirming(calls, true), runtime(true, undefined)), undefined);
  assert.match(String(calls.find((call) => call.method === "warn")?.value), /screenshot failed/);
});

interface Exec {
  file: string;
  args: string[];
  timeout: number;
}

function exec(calls: Exec[], reply: { error?: Error; stdout?: string }) {
  return (
    file: string,
    args: string[],
    options: { timeout: number },
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    calls.push({ file, args, timeout: options.timeout });
    callback(reply.error ?? null, reply.stdout ?? "");
  };
}

const listed = (devices: unknown) => ({ stdout: JSON.stringify({ devices }) });

test("off macOS there is no simulator to ask, and simctl is never run", async () => {
  const calls: Exec[] = [];
  assert.equal(await createSimulator(exec(calls, listed({})), "linux").booted(), undefined);
  assert.deepEqual(calls, []);
});

test("the booted simulator is read from simctl's device list", async () => {
  const calls: Exec[] = [];
  const runtime = createSimulator(
    exec(
      calls,
      listed({
        "iOS-17": [{ udid: "OLD", name: "iPhone 15", state: "Shutdown" }],
        "iOS-18": [
          { name: "No udid", state: "Booted" },
          { udid: "ABC", name: "iPhone 17 Pro", state: "Booted" },
        ],
      }),
    ),
    "darwin",
  );

  assert.deepEqual(await runtime.booted(), { udid: "ABC", name: "iPhone 17 Pro" });
  assert.deepEqual(calls, [{ file: "xcrun", args: ["simctl", "list", "devices", "booted", "-j"], timeout: 15_000 }]);
});

test("a booted simulator without a name is called by its udid", async () => {
  const runtime = createSimulator(exec([], listed({ "iOS-18": [{ udid: "ABC", state: "Booted" }] })), "darwin");
  assert.deepEqual(await runtime.booted(), { udid: "ABC", name: "ABC" });
});

test("no booted simulator, no device list, broken output or a failing simctl all mean none", async () => {
  const none = async (reply: { error?: Error; stdout?: string }) =>
    createSimulator(exec([], reply), "darwin").booted();

  assert.equal(await none(listed({ "iOS-18": [{ udid: "OLD", state: "Shutdown" }] })), undefined);
  assert.equal(await none({ stdout: "{}" }), undefined);
  assert.equal(await none({ stdout: "not json" }), undefined);
  assert.equal(await none({ error: new Error("xcrun: error: unable to find utility simctl") }), undefined);
});

test("a screenshot is written to a temp file, and a failed one leaves none", async () => {
  const calls: Exec[] = [];
  const file = await createSimulator(exec(calls, {}), "darwin").screenshot("ABC");

  assert.match(file ?? "", /superwall-original-\d+\.png$/);
  assert.deepEqual(calls[0]?.args, ["simctl", "io", "ABC", "screenshot", file]);
  assert.equal(await createSimulator(exec([], { error: new Error("No devices are booted.") }), "darwin").screenshot("ABC"), undefined);
});
