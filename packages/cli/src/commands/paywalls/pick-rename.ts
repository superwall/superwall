import type { FrameworkSurface } from "@/core/paywalls/project/framework";
import { RenameError, type RenameDecision, type RenameOrphan } from "@/core/paywalls/binding/renames";
import { ui } from "@/ui";

const CREATE = "__create__";

export async function pickRenameOption(input: {
  newcomer: FrameworkSurface;
  orphans: readonly RenameOrphan[];
}): Promise<RenameDecision> {
  const picked = await ui.select({
    message: `\`${input.newcomer.id}\` is not in superwall.lock. Is it a new ${input.newcomer.kind}, or renamed?`,
    options: [
      ...input.orphans.map((orphan) => ({
        value: orphan.id,
        label: `Renamed from ${orphan.id}`,
        hint: `paywall ${orphan.paywallId}`,
      })),
      { value: CREATE, label: `Create a new ${input.newcomer.kind}` },
    ],
  });

  if (picked === null) {
    throw new RenameError("Cancelled — superwall.lock is unchanged and nothing was pushed.");
  }
  return picked === CREATE ? { kind: "create" } : { kind: "rename", orphanId: picked };
}
