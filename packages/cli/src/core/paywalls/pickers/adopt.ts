import type { AdoptCandidate } from "@/core/paywalls/binding/binding";
import { ui } from "@/ui";

const ADOPT = "__adopt__";
const STOP = "__stop__";

export async function pickAdoptOption(candidate: AdoptCandidate): Promise<boolean> {
  const { surface, paywallId, applicationId } = candidate;
  const picked = await ui.select({
    message:
      `App ${applicationId} already has a paywall \`${surface.id}\` (${paywallId}), and superwall.lock ` +
      `doesn't bind it. It may belong to someone else in this app.`,
    options: [
      {
        value: STOP,
        label: "Stop",
        hint: "rename the directory to push as a new paywall",
      },
      {
        value: ADOPT,
        label: `Push to paywall ${paywallId}`,
        hint: "it's mine — bind it in superwall.lock",
      },
    ],
    initialValue: STOP,
  });
  return picked === ADOPT;
}
