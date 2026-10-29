import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { detectAgent, USER_AGENT, VERSION } from "@/environment";

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
