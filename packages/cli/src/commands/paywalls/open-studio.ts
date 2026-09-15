import { executeCommand } from "@/command";
import type { Renderer } from "@/ui";
import { runDev } from "./dev";

export async function askStudio(
  ui: Renderer,
  interactive: boolean,
  surfaceId: string,
): Promise<boolean> {
  if (!interactive) return false;
  const open = await ui.confirm({
    message: `Open the studio now, on paywall/${surfaceId} next to the original?`,
    initial: true,
  });
  return open === true;
}

export async function startStudio(superwallDir: string, surfaceId: string): Promise<void> {
  await executeCommand(
    runDev.definition,
    {
      _: [],
      $0: "superwall",
      dir: [superwallDir],
      port: 6100,
      host: "0.0.0.0",
      open: `paywall/${surfaceId}?compare=origin`,
    },
    {},
  );
}

export function migrationNextSteps(
  studioOpening: boolean,
  superwallDir: string,
  paywallId: string,
  choice: "agent" | "copy" | "later",
): string[] {
  const compare = studioOpening
    ? "The studio opens on the rebuilt paywall with the original beside it. Walk every page in both schemes (the toolbar's Compare menu switches the right pane)."
    : `Run \`superwall dev\` in ${superwallDir}, open the paywall, and pick Compare › Original in the toolbar. Walk every page in both schemes.`;
  return [
    ...(choice === "later"
      ? [`superwall migrate ${paywallId} — rebuild with your agent, or copy the prompt for one.`]
      : []),
    compare,
    "It's your code now: anything that doesn't match, ask your agent to tweak in paywalls/, and the studio reloads live.",
    "Push when it's right. The dashboard paywall keeps serving until a campaign points at the new one.",
  ];
}
