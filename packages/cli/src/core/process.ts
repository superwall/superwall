import * as fs from "node:fs";
import * as path from "node:path";

/**
 * How to start a program with `child_process`, the same on every platform.
 *
 * On Windows, tools installed through npm (`npm`, `npx`, `pnpm`, `yarn`, `claude`, `codex`) are
 * `.cmd` scripts. `spawn` and `execFile` without a shell only find `.exe` files, so `spawn("npx")`
 * fails with ENOENT, and since CVE-2024-27980 Node refuses to start a `.cmd` file directly at all.
 * Those run through `cmd.exe`, with the command line quoted for it the way cross-spawn quotes it.
 * A real executable (`git`, `node`, `where`) still starts directly, without a shell, and every
 * other platform starts `bin` as given.
 */
export interface Invocation {
  command: string;
  args: string[];
  options: { windowsVerbatimArguments?: true };
}

export interface InvocationHost {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  isFile?: (file: string) => boolean;
}

const isFile = (file: string): boolean => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

// The environment's keys are case-insensitive on Windows, so `Path` and `PATHEXT` may be spelled any way.
const envValue = (env: NodeJS.ProcessEnv, key: string): string | undefined => {
  const name = Object.keys(env).find((candidate) => candidate.toUpperCase() === key);
  return name === undefined ? undefined : env[name];
};

function windowsExecutable(bin: string, env: NodeJS.ProcessEnv, exists: (file: string) => boolean): string | undefined {
  const extensions = (envValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((ext) => ext.toLowerCase());
  const named = extensions.includes(path.win32.extname(bin).toLowerCase());
  const candidates = (base: string) => (named ? [base] : extensions.map((ext) => base + ext));
  const bases = /[\\/]/.test(bin)
    ? [bin]
    : (envValue(env, "PATH") ?? "")
        .split(";")
        .filter(Boolean)
        .map((dir) => path.join(dir.replace(/^"(.*)"$/, "$1"), bin));
  for (const base of bases) {
    const found = candidates(base).find(exists);
    if (found) return found;
  }
  return undefined;
}

// cmd.exe's metacharacters, caret-escaped (from cross-spawn, https://qntm.org/cmd).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

const escapeCommand = (command: string): string => command.replace(CMD_META, "^$1");

function escapeArgument(arg: string, twice: boolean): string {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  const once = quoted.replace(CMD_META, "^$1");
  return twice ? once.replace(CMD_META, "^$1") : once;
}

// A shim in node_modules/.bin passes its arguments on through a second cmd.exe parse.
const CMD_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

export function invocation(bin: string, args: readonly string[], host: InvocationHost = {}): Invocation {
  const platform = host.platform ?? process.platform;
  if (platform !== "win32") return { command: bin, args: [...args], options: {} };
  const env = host.env ?? process.env;
  const file = windowsExecutable(bin, env, host.isFile ?? isFile);
  if (!file || !/\.(cmd|bat)$/i.test(file)) return { command: bin, args: [...args], options: {} };
  const twice = CMD_SHIM.test(file);
  const line = [escapeCommand(path.win32.normalize(bin)), ...args.map((arg) => escapeArgument(arg, twice))].join(" ");
  return {
    command: envValue(env, "COMSPEC") ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}
