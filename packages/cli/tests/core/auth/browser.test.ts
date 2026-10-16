import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { hasDisplay, openBrowser } from "@/core/auth/browser";

const URL = "https://auth.superwall.com/device?user_code=ABCD-EFGH";

function fakeChild(event: "spawn" | "error") {
  const child = Object.assign(new EventEmitter(), { unref: () => undefined });
  process.nextTick(() =>
    event === "error"
      ? child.emit("error", Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" }))
      : child.emit("spawn"),
  );
  return child as unknown as ReturnType<typeof spawn>;
}

test("a browser command that fails to start resolves false instead of crashing", async () => {
  const calls: string[] = [];
  const opened = await openBrowser(URL, {
    platform: "linux",
    env: { DISPLAY: ":0" },
    spawn: ((cmd: string) => {
      calls.push(cmd);
      return fakeChild("error");
    }) as typeof spawn,
  });
  assert.equal(opened, false);
  assert.deepEqual(calls, ["xdg-open"]);
});

test("a missing binary reports false through a real spawn", async () => {
  const opened = await openBrowser(URL, {
    platform: "linux",
    env: { DISPLAY: ":0" },
    spawn: ((_cmd: string, args: string[], options: object) =>
      spawn("superwall-test-no-such-browser", args, options)) as typeof spawn,
  });
  assert.equal(opened, false);
});

test("a browser command that starts resolves true", async () => {
  const opened = await openBrowser(URL, {
    platform: "darwin",
    env: {},
    spawn: ((cmd: string) => {
      assert.equal(cmd, "open");
      return fakeChild("spawn");
    }) as typeof spawn,
  });
  assert.equal(opened, true);
});

test("linux without a display does not try to open a browser", async () => {
  let spawned = false;
  const opened = await openBrowser(URL, {
    platform: "linux",
    env: { SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22" },
    spawn: (() => {
      spawned = true;
      return fakeChild("spawn");
    }) as typeof spawn,
  });
  assert.equal(opened, false);
  assert.equal(spawned, false);
});

test("only linux without DISPLAY, WAYLAND_DISPLAY or WSL counts as headless", () => {
  assert.equal(hasDisplay({}, "linux"), false);
  assert.equal(hasDisplay({ DISPLAY: ":0" }, "linux"), true);
  assert.equal(hasDisplay({ WAYLAND_DISPLAY: "wayland-0" }, "linux"), true);
  assert.equal(hasDisplay({ WSL_DISTRO_NAME: "Ubuntu" }, "linux"), true);
  assert.equal(hasDisplay({}, "darwin"), true);
  assert.equal(hasDisplay({}, "win32"), true);
});
