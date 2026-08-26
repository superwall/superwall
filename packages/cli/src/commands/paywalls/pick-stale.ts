import { RenameError, type RenameOrphan, type StaleDecision } from "@/core/paywalls/binding/renames";
import { describeBindings } from "@/core/paywalls/project/lock";
import { ui } from "@/ui";

const REMOVE = "__remove__";
const KEEP = "__keep__";

export async function pickStaleOption(orphan: RenameOrphan): Promise<StaleDecision> {
  const picked = await ui.select({
    message:
      `\`${orphan.id}\` is bound to ${describeBindings(orphan.bindings)} but no longer exists on disk. ` +
      `Removing only forgets it locally — the paywall stays on Superwall, keeps ` +
      `its campaigns, and keeps serving devices.`,
    options: [
      {
        value: REMOVE,
        label: "Remove the binding",
        hint: "restoring the directory re-binds it on the next push",
      },
      { value: KEEP, label: "Keep it", hint: "superwall.lock is left as it is" },
    ],
    initialValue: REMOVE,
  });

  if (picked === null) {
    throw new RenameError("Cancelled — superwall.lock is unchanged and nothing was pushed.");
  }
  return picked === REMOVE ? "remove" : "keep";
}
