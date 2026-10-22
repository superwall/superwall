import { execFile, spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function writeTranscript(line: string): void {
  const transcript = process.env.SW_BENCH_TRANSCRIPT;
  if (!transcript) return;
  try {
    appendFileSync(transcript, line + "\n");
  } catch {
    return;
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

interface SpawnStreamOptions {
  bin: string;
  args: string[];
  cwd: string;
  onStdoutLine: (line: string) => void;
  onStderrLine?: (line: string) => void;
  signal?: AbortSignal;
}

interface SpawnStreamResult {
  code: number | null;
}

export function spawnStream(opts: SpawnStreamOptions): Promise<SpawnStreamResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.bin, opts.args, {
      cwd: opts.cwd,
      signal: opts.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const out = createInterface({ input: child.stdout });
    out.on("line", (line) => {
      if (line.length) {
        writeTranscript(line);
        opts.onStdoutLine(line);
      }
    });

    const { onStderrLine } = opts;
    if (onStderrLine) {
      const err = createInterface({ input: child.stderr });
      err.on("line", (line) => {
        if (line.length) onStderrLine(line);
      });
    }

    child.on("error", (e) => {
      if (e.name === "AbortError") {
        resolve({ code: null });
        return;
      }
      reject(e);
    });
    child.on("close", (code) => resolve({ code }));
  });
}
