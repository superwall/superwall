import { VERSION } from "@/environment";
import { defineCommand } from "@/command";
import { spawnStream } from "@/core/agent/drivers/spawn";
import { setUpdateCheck } from "@/core/state/config";
import { fetchLatestVersion, isNewerVersion } from "@/core/update";

export const runUpgrade = defineCommand({
  name: "upgrade",
  output: "both",
  async run(ctx) {
    const { ui } = ctx;

    if (process.argv[1]?.includes("_npx")) {
      if (ctx.json) return ctx.output.data({ upgraded: false, via: "npx" });
      ui.info(
        "You're running via npx, which always fetches the latest published version - nothing to upgrade.",
      );
      return;
    }

    ui.intro("Superwall upgrade");
    const spin = ui.spinner();
    spin.start("Checking the latest version");
    const latest = await fetchLatestVersion();
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
    setUpdateCheck({ latest, checkedAt: new Date().toISOString() });
    spin.stop(`Upgraded \`${VERSION}\` → \`${latest}\``);
    if (ctx.json) return ctx.output.data({ upgraded: true, from: VERSION, to: latest });
    ui.outro("You're on the latest version.");
  },
});
