import { FRAMEWORK_REF } from "@/core/workflows/agent/actions";
import { readBundledSkill, type BundledSkillId } from "@/core/support/skills";
import { detectBilling } from "@/core/codebase/billing";
import { scanProject, type DetectedApp } from "@/core/codebase/scan";
import { updateTelemetryTags, track } from "@/core/support/telemetry";

export type Playbook = "integrate" | "review" | "review-fix" | "migrate";

export async function printPlaybook(installDir: string, playbook: Playbook): Promise<void> {
  const scan = await scanProject(installDir).catch(() => null);
  const app = scan?.apps[0];
  if (app) updateTelemetryTags({ framework: app.framework.integration });
  const frameworkRef = app ? FRAMEWORK_REF[app.framework.integration] : undefined;

  if (playbook === "integrate") {
    const parts = [
      readBundledSkill("superwall-integrate", frameworkRef),
      readBundledSkill("superwall-placements", ["strategy", frameworkRef]),
      readBundledSkill("superwall-dashboard"),
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
    track("skill printed", { workflow: playbook });
    return;
  }

  const skill: BundledSkillId = playbook === "migrate" ? "superwall-migrate" : "superwall-review";
  const reference = playbook === "migrate" ? providerRef(app) : frameworkRef;
  const body = readBundledSkill(skill, reference);
  if (!body) {
    process.stderr.write(`No bundled skill found for ${playbook}.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(body + "\n");
  track("skill printed", { workflow: playbook });
}

function providerRef(app: DetectedApp | undefined): string | undefined {
  const billing = app ? detectBilling(app) : null;
  if (billing?.revenueCat) return "revenuecat";
  if (billing?.adapty) return "adapty";
  if (billing?.qonversion) return "qonversion";
  return undefined;
}
