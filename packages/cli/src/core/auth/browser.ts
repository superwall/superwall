import { spawn as nodeSpawn } from "node:child_process";

export const BROWSER_UNAVAILABLE =
  "Couldn't open a browser here. Open the URL above to approve the login.";

export interface BrowserDeps {
  spawn?: typeof nodeSpawn;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export function hasDisplay(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform !== "linux") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.WSL_DISTRO_NAME);
}

export function openBrowser(url: string, deps: BrowserDeps = {}): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  if (!hasDisplay(deps.env ?? process.env, platform)) return Promise.resolve(false);
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve) => {
    try {
      const child = (deps.spawn ?? nodeSpawn)(cmd, args, { stdio: "ignore", detached: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => resolve(true));
      child.unref();
    } catch {
      resolve(false);
    }
  });
}
