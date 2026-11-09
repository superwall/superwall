import assert from "node:assert/strict";
import { test } from "node:test";
import { invocation } from "@/core/process";

const NODE_DIR = "C:\\Program Files\\nodejs";

const windows = (files: string[], env: NodeJS.ProcessEnv = {}) => ({
  platform: "win32" as const,
  env: { Path: `${NODE_DIR};C:\\Windows\\System32`, ComSpec: "C:\\Windows\\system32\\cmd.exe", ...env },
  // path.join is posix off Windows, so a joined candidate comes back with one forward slash.
  isFile: (file: string) => files.includes(file.replaceAll("/", "\\")),
});

test("off Windows a program starts as named, with its arguments untouched", () => {
  assert.deepEqual(invocation("npx", ["-y", "skills@latest", "a b"], { platform: "darwin" }), {
    command: "npx",
    args: ["-y", "skills@latest", "a b"],
    options: {},
  });
});

test("on Windows npx, a .cmd script, runs through cmd.exe with every argument quoted", () => {
  const run = invocation(
    "npx",
    ["-y", "skills@latest", "add", "https://github.com/superwall/skills/tree/next", "--global", "--skill", "*"],
    windows([`${NODE_DIR}\\npx.cmd`]),
  );
  assert.equal(run.command, "C:\\Windows\\system32\\cmd.exe");
  assert.deepEqual(run.options, { windowsVerbatimArguments: true });
  assert.deepEqual(run.args, [
    "/d",
    "/s",
    "/c",
    '"npx ^"-y^" ^"skills@latest^" ^"add^" ^"https://github.com/superwall/skills/tree/next^" ^"--global^" ^"--skill^" ^"^*^""',
  ]);
});

test("cmd.exe metacharacters, spaces, quotes and trailing backslashes stay one literal argument", () => {
  const run = invocation(
    "npx",
    ["C:\\Users\\Jo Doe\\skills\\", 'say "hi" & exit', "100%"],
    windows([`${NODE_DIR}\\npx.cmd`]),
  );
  assert.equal(
    run.args[3],
    '"npx ^"C:\\Users\\Jo^ Doe\\skills\\\\^" ^"say^ \\^"hi\\^"^ ^&^ exit^" ^"100^%^""',
  );
});

test("a shim in node_modules/.bin is escaped twice, for the second parse it makes", () => {
  const shim = "C:\\work\\node_modules\\.bin\\codex.cmd";
  const run = invocation("codex", ["a&b"], windows([shim], { Path: "C:\\work\\node_modules\\.bin" }));
  assert.equal(run.args[3], '"codex ^^^"a^^^&b^^^""');
});

test("a real executable on Windows starts directly, without a shell", () => {
  const run = invocation("git", ["clone", "a b"], windows(["C:\\Windows\\System32\\git.exe"]));
  assert.deepEqual(run, { command: "git", args: ["clone", "a b"], options: {} });
});

test("the first PATH directory holding the program wins, in PATHEXT order", () => {
  const files = [`${NODE_DIR}\\npm.cmd`, "C:\\Windows\\System32\\npm.exe"];
  assert.equal(invocation("npm", ["-v"], windows(files)).command, "C:\\Windows\\system32\\cmd.exe");
  const exeFirst = windows([`${NODE_DIR}\\npm.exe`, `${NODE_DIR}\\npm.cmd`], { PATHEXT: ".EXE;.CMD" });
  assert.equal(invocation("npm", ["-v"], exeFirst).command, "npm");
});

test("a program named with its extension or a path is looked up as named", () => {
  const cmd = `${NODE_DIR}\\npx.cmd`;
  assert.equal(invocation("npx.cmd", [], windows([cmd])).args[3], '"npx.cmd"');
  assert.equal(invocation(cmd, ["x"], windows([cmd])).args[3], `"C:\\Program^ Files\\nodejs\\npx.cmd ^"x^""`);
});

test("a program that is nowhere on PATH is started as named, to fail as it would", () => {
  assert.deepEqual(invocation("npx", ["-v"], windows([])), { command: "npx", args: ["-v"], options: {} });
});

test("without COMSPEC the shell is cmd.exe, and a quoted PATH entry is still searched", () => {
  const run = invocation("npx", [], {
    platform: "win32",
    env: { PATH: `"${NODE_DIR}"` },
    isFile: (file) => file.replaceAll("/", "\\") === `${NODE_DIR}\\npx.cmd`,
  });
  assert.equal(run.command, "cmd.exe");
});
