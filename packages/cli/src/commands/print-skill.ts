import { resolve } from "node:path";
import type { Arguments } from "yargs";
import { scanProject } from "@/core/project/scan";
import { detectBilling } from "@/core/project/billing";
import { FRAMEWORK_REF, type ActionId } from "@/core/agent/actions";
import { loadBundledSkill, type BundledSkillId } from "@/core/agent/skills";
import { setTelemetryTags, track } from "@/core/telemetry";

/**
 * `<command> --skill` - print the raw playbook (skill + this project's
 * framework/provider reference) for an agent to follow directly, instead of
 * the CLI orchestrating the run. Stdout must stay clean markdown.
 */
export function runPrintSkill(actionId: ActionId): (argv: Arguments) => Promise<void> {
  return async (argv) => {
    const dir = resolve((argv.installDir as string | undefined) ?? process.cwd());
    const scan = await scanProject(dir).catch(() => null);
    const app = scan?.apps[0];
    if (app) setTelemetryTags({ framework: app.framework.integration });
    const frameworkRef = app ? FRAMEWORK_REF[app.framework.integration] : undefined;

    // `integrate --skill` includes the full SDK, placement, and campaign journey.
    if (actionId === "integrate") {
      const parts = [
        loadBundledSkill("superwall-integrate", frameworkRef),
        loadBundledSkill("superwall-placements", ["strategy", frameworkRef]),
        loadBundledSkill("superwall-dashboard"),
      ].filter(Boolean);
      if (!parts.length) {
        process.stderr.write("No bundled skills found for integrate.\n");
        process.exitCode = 1;
        return;
      }
      process.stdout.write(
        "# Set up Superwall - full integration\n\nDo all three phases in order:\n\n---\n\n" +
          parts.join("\n\n---\n\n") +
          "\n",
      );
      track("skill printed", { workflow: actionId });
      return;
    }

    let skill: BundledSkillId;
    let reference: string | undefined;
    let withStrategy = false;
    switch (actionId) {
      case "review":
      case "review-fix":
        skill = "superwall-review";
        reference = frameworkRef;
        break;
      case "placements-review":
      case "placements-implement":
        skill = "superwall-placements";
        reference = frameworkRef;
        withStrategy = true;
        break;
      case "dashboard-setup":
        skill = "superwall-dashboard";
        break;
      case "migrate": {
        skill = "superwall-migrate";
        const billing = app ? detectBilling(app) : null;
        reference = billing?.revenueCat
          ? "revenuecat"
          : billing?.adapty
            ? "adapty"
            : billing?.qonversion
              ? "qonversion"
              : undefined;
        break;
      }
    }

    const body = loadBundledSkill(skill, withStrategy ? ["strategy", reference] : reference);
    if (!body) {
      process.stderr.write(`No bundled skill found for ${actionId}.\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(body + "\n");
    track("skill printed", { workflow: actionId });
  };
}
