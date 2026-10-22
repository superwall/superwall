import pc from "picocolors";
import type { CommandContext } from "@/program/command";
import { spawnStream } from "@/core/workflows/agent/drivers/spawn";
import { writeUpdateCheck, readUpdateCheck } from "@/core/state/config";
import { RUNNING_VIA_NPX, VERSION } from "@/environment";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = "https://registry.npmjs.org/superwall/latest";

const pending: Array<Promise<unknown>> = [];

export function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split(".").map((n) => parseInt(n, 10));
  const c = current.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const a = l[i] ?? 0;
    const b = c[i] ?? 0;
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (a !== b) return a > b;
  }
  return false;
}

async function selectLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const { version } = (await res.json()) as { version?: string };
    return version ?? null;
  } catch {
    return null;
  }
}

function selectAvailableUpdate(): string | null {
  const latest = readUpdateCheck()?.latest;
  if (!latest || !isNewerVersion(latest, VERSION)) return null;
  return latest;
}

export function refreshUpdateCheck(): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  const cached = readUpdateCheck();
  const age = cached?.checkedAt ? Date.now() - Date.parse(cached.checkedAt) : Infinity;
  if (age < CHECK_INTERVAL_MS) return;
  pending.push(
    selectLatestVersion().then((version) => {
      if (version) writeUpdateCheck({ latest: version, checkedAt: new Date().toISOString() });
    }),
  );
}

export async function flushUpdateCheck(capMs = 2000): Promise<void> {
  if (pending.length === 0) return;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise((done) => setTimeout(done, capMs).unref()),
  ]);
}

export function maybeNotifyUpdate(stream: Pick<NodeJS.WriteStream, "write">): void {
  const latest = selectAvailableUpdate();
  if (!latest) return;
  stream.write(`${pc.dim(`Update available ${VERSION} → ${latest} · run \`superwall upgrade\``)}\n`);
}

export async function runUpgrade(ctx: CommandContext<"none">): Promise<void> {
  const { ui } = ctx;

  if (RUNNING_VIA_NPX()) {
    if (ctx.json) return ctx.output.data({ upgraded: false, via: "npx" });
    ui.info(
      "You're running via npx, which always fetches the latest published version - nothing to upgrade.",
    );
    return;
  }

  ui.intro("Superwall upgrade");
  const spin = ui.spinner();
  spin.start("Checking the latest version");
  const latest = await selectLatestVersion();
  if (!latest) {
    spin.stop("Check failed");
    throw new Error("Couldn't reach the npm registry - try again.");
  }
  if (!isNewerVersion(latest, VERSION)) {
    spin.stop(`You're on the latest version (\`${VERSION}\`)`);
    if (ctx.json) return ctx.output.data({ upgraded: false, version: VERSION });
    return;
  }

  spin.message(`Upgrading \`${VERSION}\` → \`${latest}\``);
  const errors: string[] = [];
  const { code } = await spawnStream({
    bin: "npm",
    args: ["install", "--global", `superwall@${latest}`],
    cwd: process.cwd(),
    onStdoutLine: () => {},
    onStderrLine: (line) => errors.push(line),
  });
  if (code !== 0) {
    spin.stop("Upgrade failed");
    const detail = errors.slice(-3).join(" ").trim();
    throw new Error(
      `npm couldn't upgrade the package${detail ? ` (${detail.slice(0, 200)})` : ""}. Try: npm install --global superwall@latest`,
    );
  }
  writeUpdateCheck({ latest, checkedAt: new Date().toISOString() });
  spin.stop(`Upgraded \`${VERSION}\` → \`${latest}\``);
  if (ctx.json) return ctx.output.data({ upgraded: true, from: VERSION, to: latest });
  ui.outro("You're on the latest version.");
}
