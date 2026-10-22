import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-test-home-"));
process.env.SUPERWALL_HOME = home;
process.env.SUPERWALL_AGENT_SKILLS_DIR = path.join(home, "no-installed-skills");
process.env.SUPERWALL_CHANNEL = "next";

const { installTerminal } = await import("@/hosts/terminal");
installTerminal();

process.on("exit", () => {
  fs.rmSync(home, { recursive: true, force: true });
});
