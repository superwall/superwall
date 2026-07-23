import { ui } from "@/ui";
import { SUPPORTED_LABEL } from "@/core/project/frameworks";
import { scanProject } from "@/core/project/scan";

export async function runFallback(installDir: string): Promise<void> {
  const scan = await scanProject(installDir);
  const top = scan.apps[0];

  if (!top) {
    if (scan.unsupported.length) {
      throw new Error("Detected a web app. This command supports mobile apps.");
    }
    throw new Error(`No ${SUPPORTED_LABEL} app found here.`);
  }

  ui.info(`Detected ${top.framework.name}${top.details ? ` · ${top.details}` : ""}`);
  ui.note(
    [
      `1. Install the SDK: ${top.framework.sdkPackage}`,
      `2. Configure Superwall with your public API key at app launch.`,
      `3. Register one placement: register("campaign_trigger").`,
      ``,
      `Full guide: ${top.framework.docsUrl}`,
    ].join("\n"),
    "Manual setup",
  );
  ui.note(
    [
      "For automated setup, install an agent and run `superwall integrate` again:",
      "Claude Code: npm install --global @anthropic-ai/claude-code",
      "Codex: npm install --global @openai/codex",
    ].join("\n"),
    "Automated setup",
  );
  ui.outro("Re-run `superwall integrate` after installing an agent.");
}
