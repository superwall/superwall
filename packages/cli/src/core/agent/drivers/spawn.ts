import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Benchmark-only transcript sink: when SW_BENCH_TRANSCRIPT points at a file,
// every raw agent stream-json line is appended there so the harness can capture
// the full agent conversation (all phases) for the clickable dashboard. Unset in
// normal use → zero effect.
const TRANSCRIPT = process.env.SW_BENCH_TRANSCRIPT;
function sink(line: string): void {
  if (!TRANSCRIPT) return;
  try {
    appendFileSync(TRANSCRIPT, line + "\n");
  } catch {
    /* never let transcript I/O break a run */
  }
}

export async function readVersion(bin: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], {
      timeout: 5000,
    });
    return stdout.trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

export async function onPath(bin: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [bin] : ["-v", bin];
  try {
    await execFileAsync(probe, args, {
      timeout: 5000,
      shell: process.platform !== "win32",
    });
    return true;
  } catch {
    return false;
  }
}

export interface SpawnStreamOptions {
  bin: string;
  args: string[];
  cwd: string;
  onStdoutLine: (line: string) => void;
  onStderrLine?: (line: string) => void;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface SpawnStreamResult {
  code: number | null;
}

export function spawnStream(opts: SpawnStreamOptions): Promise<SpawnStreamResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.bin, opts.args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      signal: opts.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const out = createInterface({ input: child.stdout });
    out.on("line", (line) => {
      if (line.length) {
        sink(line);
        opts.onStdoutLine(line);
      }
    });

    if (opts.onStderrLine && child.stderr) {
      const err = createInterface({ input: child.stderr });
      err.on("line", (line) => {
        if (line.length) opts.onStderrLine!(line);
      });
    }

    child.on("error", (e) => {
      if ((e as NodeJS.ErrnoException).name === "AbortError") {
        resolve({ code: null });
        return;
      }
      reject(e);
    });
    child.on("close", (code) => resolve({ code }));
  });
}
