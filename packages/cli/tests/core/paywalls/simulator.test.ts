import assert from "node:assert/strict";
import { test } from "node:test";
import { askForScreenshot, simulator, type SimulatorRuntime } from "@/core/paywalls/simulator";
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

test("the real runtime never throws when simctl is unavailable", async () => {
  const booted = await simulator.booted();
  assert.ok(booted === undefined || typeof booted.udid === "string");
  const shot = await simulator.screenshot("no-such-device");
  assert.equal(shot, undefined);
});
