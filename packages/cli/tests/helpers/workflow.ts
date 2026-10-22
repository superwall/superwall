import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { mock } from "node:test";
import { claudeDriver } from "@/core/workflows/agent/drivers/claude";
import { codexDriver } from "@/core/workflows/agent/drivers/codex";
import { superwallDriver } from "@/core/workflows/agent/drivers/superwall";
import type { AgentDriver, AgentResult, AgentRunOptions } from "@/core/workflows/agent/drivers/index";
import type { CommandContext } from "@/program/command";
import { runLifecycle } from "@/program/lifecycle";
import { answeringRenderer, type Answers } from "./answers";
import type { Route } from "./fetch";
import type { RendererCall } from "./renderer";

type DriverId = "claude" | "codex" | "superwall";

const DRIVERS: Record<DriverId, AgentDriver> = { claude: claudeDriver, codex: codexDriver, superwall: superwallDriver };

export interface AgentRun {
  driver: DriverId;
  options: AgentRunOptions;
}

export function useAgents(installed: Partial<Record<DriverId, AgentResult[]>>): AgentRun[] {
  const runs: AgentRun[] = [];
  for (const [id, driver] of Object.entries(DRIVERS) as [DriverId, AgentDriver][]) {
    const results = installed[id];
    mock.method(driver, "detect", async () =>
      results ? { id, displayName: driver.displayName, bin: id, version: "1.0.0" } : null,
    );
    mock.method(driver, "run", async (options: AgentRunOptions): Promise<AgentResult> => {
      runs.push({ driver: id, options });
      options.onEvent?.({ type: "status", text: "Reading the project" });
      options.onEvent?.({ type: "text", text: "thinking" });
      const result = results?.shift();
      if (!result) throw new Error(`${id} ran more often than the test expected`);
      return result;
    });
  }
  return runs;
}

const sandboxes: string[] = [];
let savedPath: string | undefined;

export function useSandboxPath(bins: Record<string, string> = {}): { clipboard: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-sandbox-bin-"));
  sandboxes.push(dir);
  const clipboard = path.join(dir, "clipboard.txt");
  const all: Record<string, string> = {
    npx: "exit 0",
    git: "exit 1",
    pbcopy: `/bin/cat > ${clipboard}`,
    xclip: `/bin/cat > ${clipboard}`,
    ...bins,
  };
  for (const [name, script] of Object.entries(all)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${script}\n`);
    fs.chmodSync(file, 0o755);
  }
  savedPath ??= process.env.PATH;
  process.env.PATH = dir;
  return { clipboard };
}

export function restoreSandboxPath(): void {
  if (savedPath !== undefined) process.env.PATH = savedPath;
  savedPath = undefined;
  for (const dir of sandboxes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export interface WorkflowRun {
  calls: RendererCall[];
  failed: boolean;
}

export async function runWorkflow(
  work: (ctx: CommandContext<"optional">) => Promise<void>,
  options: { installDir: string; answers?: Answers; interactive?: boolean; dryRun?: boolean },
): Promise<WorkflowRun> {
  const calls: RendererCall[] = [];
  const interactive = options.interactive ?? options.answers !== undefined;
  process.exitCode = 0;
  await runLifecycle<"optional">(
    { name: "workflow", auth: "optional", json: false, prompts: true },
    { flags: { installDir: options.installDir, dryRun: options.dryRun === true }, interactive },
    { renderer: () => answeringRenderer(options.answers ?? {}, calls), nonInteractive: !interactive, waitForPaint: false },
    work,
  );
  const failed = process.exitCode === 1;
  process.exitCode = 0;
  return { calls, failed };
}

export function expoApp(files: Record<string, string> = {}, dependencies: Record<string, string> = {}): string {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sw-workflow-")), "Acme");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "acme", dependencies: { expo: "51.0.0", ...dependencies } }));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

export const INTEGRATED = {
  "App.tsx": 'import { SuperwallProvider } from "expo-superwall";\nconst key = "pk_live_abcdef123";\n',
};

export function iosApp(files: Record<string, string> = {}): string {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sw-workflow-")), "Acme");
  fs.mkdirSync(path.join(root, "Acme.xcodeproj"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

export const AUTH_HOST = "https://auth.test";
export const API_HOST = "https://api.test";

export function useLoginHosts(): void {
  process.env.SUPERWALL_AUTH_HOST = AUTH_HOST;
  process.env.SUPERWALL_API_HOST = API_HOST;
}

export function clearLoginHosts(): void {
  delete process.env.SUPERWALL_AUTH_HOST;
  delete process.env.SUPERWALL_API_HOST;
}

export function loginRoutes(orgs: unknown[] = [{ id: 7, name: "Acme Inc" }]): Route[] {
  return [
    {
      match: "/.well-known/openid-configuration",
      body: {
        token_endpoint: `${AUTH_HOST}/oauth2/token`,
        device_authorization_endpoint: `${AUTH_HOST}/oauth2/device_authorization`,
      },
    },
    {
      match: "/oauth2/device_authorization",
      body: { device_code: "device-1", user_code: "ABCD-EFGH", verification_uri: `${AUTH_HOST}/device`, interval: 0, expires_in: 300 },
    },
    { match: "/oauth2/token", body: { access_token: "token-1", refresh_token: "refresh-1", expires_in: 3600 } },
    { match: `${API_HOST}/v2/me/organizations`, body: { data: orgs } },
    { match: `${API_HOST}/v2/me`, body: { email: "ana@acme.dev" } },
  ];
}
