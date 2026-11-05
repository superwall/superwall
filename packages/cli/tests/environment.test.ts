import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_UPDATE, AUTO_UPDATE_TARGET, detectAgent, USER_AGENT, VERSION } from "@/environment";

const MARKERS = ["CLAUDECODE", "CODEX_SANDBOX", "CURSOR_AGENT", "GEMINI_CLI"];
const saved = Object.fromEntries(MARKERS.map((key) => [key, process.env[key]]));

const clearMarkers = () => {
  for (const key of MARKERS) delete process.env[key];
};

afterEach(() => {
  clearMarkers();
  for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
});

test("agent is detected from its env marker", () => {
  assert.equal(detectAgent({ CLAUDECODE: "1" }), "claude-code");
  assert.equal(detectAgent({ CODEX_SANDBOX: "seatbelt" }), "codex");
  assert.equal(detectAgent({}), undefined);
});

test("the User-Agent names the CLI version, and the agent driving it when there is one", () => {
  clearMarkers();
  assert.equal(USER_AGENT(), `superwall-cli/${VERSION}`);
  process.env.CURSOR_AGENT = "1";
  assert.equal(USER_AGENT(), `superwall-cli/${VERSION} (cursor)`);
});

test("the automatic update is off when its switch is on, in CI and under npx", () => {
  const saved = { off: process.env.SUPERWALL_NO_UPDATE, ci: process.env.CI, entry: process.argv[1] };
  const restore = () => {
    for (const [key, value] of [["SUPERWALL_NO_UPDATE", saved.off], ["CI", saved.ci]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.argv[1] = saved.entry ?? "";
  };
  try {
    delete process.env.SUPERWALL_NO_UPDATE;
    delete process.env.CI;
    assert.equal(AUTO_UPDATE(), true);
    for (const value of ["1", "true", "yes"]) {
      process.env.SUPERWALL_NO_UPDATE = value;
      assert.equal(AUTO_UPDATE(), false, value);
    }
    for (const value of ["0", "false", "FALSE", " "]) {
      process.env.SUPERWALL_NO_UPDATE = value;
      assert.equal(AUTO_UPDATE(), true, value);
    }
    delete process.env.SUPERWALL_NO_UPDATE;
    process.env.CI = "true";
    assert.equal(AUTO_UPDATE(), false);
    process.env.CI = "false";
    assert.equal(AUTO_UPDATE(), true);
    process.argv[1] = "/Users/dev/.npm/_npx/abc/node_modules/.bin/superwall";
    assert.equal(AUTO_UPDATE(), false);
  } finally {
    restore();
  }
});

test("the version to update to comes from the parent run", () => {
  const saved = process.env.SW_AUTO_UPDATE;
  try {
    delete process.env.SW_AUTO_UPDATE;
    assert.equal(AUTO_UPDATE_TARGET(), undefined);
    process.env.SW_AUTO_UPDATE = "2.4.0";
    assert.equal(AUTO_UPDATE_TARGET(), "2.4.0");
  } finally {
    if (saved === undefined) delete process.env.SW_AUTO_UPDATE;
    else process.env.SW_AUTO_UPDATE = saved;
  }
});
