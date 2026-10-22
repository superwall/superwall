import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Session } from "@/core/account/storage";

const homes: string[] = [];
const baseline = process.env.SUPERWALL_HOME;

export function useHome(session?: Partial<Session>): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-home-"));
  homes.push(home);
  process.env.SUPERWALL_HOME = home;
  if (session) {
    fs.writeFileSync(
      path.join(home, "auth.json"),
      JSON.stringify({
        host: "https://api.example.com",
        createdAt: new Date().toISOString(),
        ...session,
      }),
    );
  }
  return home;
}

export function clearHomes(): void {
  if (baseline === undefined) delete process.env.SUPERWALL_HOME;
  else process.env.SUPERWALL_HOME = baseline;
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
}
