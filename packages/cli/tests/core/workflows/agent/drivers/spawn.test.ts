import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  onPath,
  quoteForCmd,
  readVersion,
  spawnStream,
} from "@/core/workflows/agent/drivers/spawn";
import { restoreBin, useBin } from "../../../../helpers/bin";

const dirs: string[] = [];

function onlyBins(bins: Record<string, string>): string {
  const dir = useBin(bins);
  process.env.PATH = dir;
  return dir;
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-spawn-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  restoreBin();
  delete process.env.SW_BENCH_TRANSCRIPT;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("a binary on PATH is found and one that is not is not", async () => {
  onlyBins({ fake: "exit 0" });

  assert.equal(await onPath("fake"), true);
  assert.equal(await onPath("missing-binary"), false);
});

test("on Windows a binary is looked up with where", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const seen = path.join(tempDir(), "where-args");
  onlyBins({ where: `printf '%s' "$*" > "${seen}"; [ "$1" = "fake" ]` });
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    assert.equal(await onPath("fake"), true);
    assert.equal(fs.readFileSync(seen, "utf8"), "fake");
    assert.equal(await onPath("missing-binary"), false);
  } finally {
    if (platform) Object.defineProperty(process, "platform", platform);
  }
});

test("the version is the first line the binary prints, and absent when it cannot run", async () => {
  onlyBins({ fake: 'echo "  fake 2.1.0"; echo "build abc"', broken: "exit 3" });

  assert.equal(await readVersion("fake"), "fake 2.1.0");
  assert.equal(await readVersion("broken"), undefined);
  assert.equal(await readVersion("missing-binary"), undefined);
});

test("stdout and stderr stream line by line, skipping blank lines, with the exit code", async () => {
  const cwd = tempDir();
  onlyBins({ fake: 'echo "one"; echo ""; echo "two"; echo "oops" >&2; echo "" >&2; pwd; exit 4' });
  const out: string[] = [];
  const err: string[] = [];

  const { code } = await spawnStream({
    bin: "fake",
    args: [],
    cwd,
    onStdoutLine: (line) => out.push(line),
    onStderrLine: (line) => err.push(line),
  });

  assert.equal(code, 4);
  assert.deepEqual(out, ["one", "two", fs.realpathSync(cwd)]);
  assert.deepEqual(err, ["oops"]);
});

test("on Windows the command runs through cmd.exe with each argument quoted whole", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const comspec = process.env.ComSpec;
  delete process.env.ComSpec;
  delete process.env.COMSPEC;
  onlyBins({ "cmd.exe": `for a in "$@"; do printf '%s\\n' "[$a]"; done` });
  Object.defineProperty(process, "platform", { value: "win32" });
  const out: string[] = [];
  try {
    const { code } = await spawnStream({
      bin: "npx",
      args: ["-y", "skills@latest", "add", "C:\\Users\\First Last\\skills", "--copy"],
      cwd: tempDir(),
      onStdoutLine: (line) => out.push(line),
    });

    assert.equal(code, 0);
    assert.deepEqual(out, [
      "[/d]",
      "[/s]",
      "[/c]",
      '["npx -y skills@latest add "C:\\Users\\First Last\\skills" --copy"]',
    ]);
  } finally {
    if (platform) Object.defineProperty(process, "platform", platform);
    if (comspec !== undefined) process.env.ComSpec = comspec;
  }
});

test("an argument is quoted for cmd only when it needs it", () => {
  assert.equal(quoteForCmd("--global"), "--global");
  assert.equal(quoteForCmd("skills@latest"), "skills@latest");
  assert.equal(quoteForCmd("C:\\Users\\me\\skills"), "C:\\Users\\me\\skills");
  assert.equal(
    quoteForCmd("C:\\Program Files\\nodejs\\npx.cmd"),
    '"C:\\Program Files\\nodejs\\npx.cmd"',
  );
  assert.equal(quoteForCmd("a&b|c<d>e^(f)"), '"a&b|c<d>e^(f)"');
  assert.equal(quoteForCmd(""), '""');
  assert.equal(quoteForCmd('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteForCmd('C:\\dir\\"x'), '"C:\\dir\\\\\\"x"');
  assert.equal(quoteForCmd("C:\\First Last\\"), '"C:\\First Last\\\\"');
});

test("arguments reach the binary, and stderr is ignored without a listener", async () => {
  onlyBins({ fake: 'echo "$1|$2"; echo "noise" >&2' });
  const out: string[] = [];

  const { code } = await spawnStream({
    bin: "fake",
    args: ["a b", "c"],
    cwd: tempDir(),
    onStdoutLine: (line) => out.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(out, ["a b|c"]);
});

test("a benchmark transcript records every stdout line", async () => {
  const transcript = path.join(tempDir(), "transcript.jsonl");
  process.env.SW_BENCH_TRANSCRIPT = transcript;
  onlyBins({ fake: 'echo "{\\"a\\":1}"; echo "" ; echo "done"' });

  await spawnStream({ bin: "fake", args: [], cwd: tempDir(), onStdoutLine: () => {} });

  assert.equal(fs.readFileSync(transcript, "utf8"), '{"a":1}\ndone\n');
});

test("an unwritable transcript never interrupts the run", async () => {
  process.env.SW_BENCH_TRANSCRIPT = tempDir();
  onlyBins({ fake: 'echo "line"' });
  const out: string[] = [];

  const { code } = await spawnStream({
    bin: "fake",
    args: [],
    cwd: tempDir(),
    onStdoutLine: (line) => out.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(out, ["line"]);
});

test("an aborted run ends with no exit code", async () => {
  onlyBins({ fake: 'echo "started"; exec /bin/sleep 10' });
  const controller = new AbortController();

  const { code } = await spawnStream({
    bin: "fake",
    args: [],
    cwd: tempDir(),
    signal: controller.signal,
    onStdoutLine: () => controller.abort(),
  });

  assert.equal(code, null);
});

test("a binary that cannot start is an error", async () => {
  onlyBins({});

  await assert.rejects(
    spawnStream({ bin: "missing-binary", args: [], cwd: tempDir(), onStdoutLine: () => {} }),
    /ENOENT/,
  );
});
