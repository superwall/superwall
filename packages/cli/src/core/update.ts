import pc from "picocolors";
import { VERSION } from "@/constants";
import { getUpdateCheck, setUpdateCheck } from "@/core/state/config";

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

export async function fetchLatestVersion(): Promise<string | null> {
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

export function availableUpdate(): string | null {
  const cached = getUpdateCheck();
  return cached?.latest && isNewerVersion(cached.latest, VERSION) ? cached.latest : null;
}

export function refreshUpdateCheck(): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  const cached = getUpdateCheck();
  const age = cached?.checkedAt ? Date.now() - Date.parse(cached.checkedAt) : Infinity;
  if (age < CHECK_INTERVAL_MS) return;
  pending.push(
    fetchLatestVersion().then((version) => {
      if (version) setUpdateCheck({ latest: version, checkedAt: new Date().toISOString() });
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
  const latest = availableUpdate();
  if (!latest) return;
  stream.write(`${pc.dim(`Update available ${VERSION} → ${latest} · run \`superwall upgrade\``)}\n`);
}
