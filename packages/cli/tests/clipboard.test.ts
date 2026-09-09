import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { copyToClipboard } from "@/clipboard";
import { restoreBin, useBin } from "./helpers/bin";

const clipboardBin =
  process.platform === "darwin" ? "pbcopy" : process.platform === "win32" ? "clip" : "xclip";

afterEach(() => {
  restoreBin();
});

test("copies through the platform's clipboard command", async () => {
  const sink = path.join(os.tmpdir(), `sw-clip-${process.pid}.txt`);
  fs.rmSync(sink, { force: true });
  useBin({ [clipboardBin]: `cat > ${sink}` });

  assert.equal(await copyToClipboard("pk_live_secret"), true);
  assert.equal(fs.readFileSync(sink, "utf8"), "pk_live_secret");
  fs.rmSync(sink, { force: true });
});

test("a clipboard command that fails is reported, not thrown", async () => {
  useBin({ [clipboardBin]: "exit 3" });

  assert.equal(await copyToClipboard("nope"), false);
});

test("a missing clipboard command is reported, not thrown", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sw-noclip-"));
  const saved = process.env.PATH;
  process.env.PATH = empty;
  try {
    assert.equal(await copyToClipboard("nope"), false);
  } finally {
    process.env.PATH = saved;
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
