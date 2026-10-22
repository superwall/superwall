import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { detectDrivers } from "@/core/workflows/agent/drivers/index";
import { restoreBin, useBin } from "../../../../helpers/bin";

const version = (text: string) => `if [ "$1" = "--version" ]; then echo "${text}"; fi`;

afterEach(() => {
  restoreBin();
});

test("installed agents are detected in priority order, with the bundled agent last", async () => {
  process.env.PATH = useBin({ codex: version("codex-cli 0.50.0"), claude: version("2.1.0 (Claude Code)") });

  const detected = await detectDrivers();

  assert.deepEqual(
    detected.map(({ driver, info }) => [driver.id, info.version]),
    [
      ["claude", "2.1.0 (Claude Code)"],
      ["codex", "codex-cli 0.50.0"],
      ["superwall", undefined],
    ],
  );
});

test("an agent that is not installed is left out", async () => {
  process.env.PATH = useBin({ codex: version("codex-cli 0.50.0") });

  const detected = await detectDrivers();

  assert.deepEqual(
    detected.map(({ driver }) => driver.id),
    ["codex", "superwall"],
  );
});
