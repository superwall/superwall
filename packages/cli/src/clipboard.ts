import { spawn } from "node:child_process";

export async function copyToClipboard(text: string): Promise<boolean> {
  const cmd = clipboardCommand();
  if (!cmd) return false;
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd.command, cmd.args, {
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
      child.stdin.on("error", () => resolve(false));
      child.stdin.write(text);
      child.stdin.end();
    } catch {
      resolve(false);
    }
  });
}

function clipboardCommand(): { command: string; args: string[] } | null {
  switch (process.platform) {
    case "darwin":
      return { command: "pbcopy", args: [] };
    case "win32":
      return { command: "clip", args: [] };
    default:
      return { command: "xclip", args: ["-selection", "clipboard"] };
  }
}
