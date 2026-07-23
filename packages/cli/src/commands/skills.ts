import { ui } from "@/ui";
import { withSpinner } from "@/ui/spinner";
import { defineCommand } from "@/command";
import {
  SUPERWALL_SKILLS_SOURCE,
  fetchPublicSkills,
  skillsOutOfDate,
  syncSkills,
} from "@/core/agent/skills";

export const runSkills = defineCommand({
  name: "skills",
  async run(ctx) {
    ui.intro("Superwall agent skills");

    let skills = normalizeList(ctx.argv.skill);
    const { dryRun, interactive } = ctx;
    const force = Boolean(ctx.argv.force);

    if (!skills && !dryRun && !force) {
      const stale = await withSpinner("Checking your skills", skillsOutOfDate);
      if (!stale) {
        ui.success("Your Superwall skills are already up to date.");
        ui.outro("Run `superwall skills --force` to reinstall.");
        return;
      }
    }

    if (!skills && !dryRun && interactive) {
      const available = await withSpinner(
        `Fetching skills from ${SUPERWALL_SKILLS_SOURCE}`,
        fetchPublicSkills,
      );
      const picked = await ui.multiselect({
        message: `Which skills from ${SUPERWALL_SKILLS_SOURCE}? (installs globally)`,
        options: available.map((s) => ({
          value: s.name,
          label: s.name,
          hint: s.summary,
        })),
        initialValues: available.map((s) => s.name),
      });
      if (picked === null || picked.length === 0) {
        ui.warn("Nothing selected.");
        return;
      }
      skills = picked.length === available.length ? undefined : picked;
    } else if (skills?.length) {
      ui.info(`Installing \`${skills.join("`, `")}\` from ${SUPERWALL_SKILLS_SOURCE}`);
    } else {
      ui.info(`Installing every skill from ${SUPERWALL_SKILLS_SOURCE}`);
    }

    const spin = ui.spinner();
    spin.start(dryRun ? "Resolving" : "Installing skills globally");
    const { ok, commands } = await syncSkills({ skills, dryRun });
    spin.stop(
      dryRun ? "Dry run" : ok ? "Skills installed for every detected agent" : "Install failed",
    );

    if (dryRun) for (const command of commands) ui.info(command);
    ui.outro(
      ok
        ? `**Done.** Try: ask your agent to "review my Superwall setup".`
        : "Something went wrong - try again, or check that `npx` is available.",
    );
    if (!ok)
      throw new Error("Skill installation failed. Check that `npx` is available and try again.");
  },
});

function normalizeList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  return undefined;
}
