import { executeCommand } from "@/command";
import type { Renderer } from "@/ui";
import { runDev } from "./dev";

export async function askStudio(
  ui: Renderer,
  interactive: boolean,
  surfaceId: string,
  original = true,
): Promise<boolean> {
  if (!interactive) return false;
  const open = await ui.confirm({
    message: original
      ? `Open the studio now, on paywall/${surfaceId} next to the original?`
      : `Open the studio now, on paywall/${surfaceId}?`,
    initial: true,
  });
  return open === true;
}

export async function startStudio(
  superwallDir: string,
  surfaceId: string,
  original = true,
): Promise<void> {
  await executeCommand(
    runDev.definition,
    {
      _: [],
      $0: "superwall",
      dir: [superwallDir],
      port: 6100,
      host: "0.0.0.0",
      open: original ? `paywall/${surfaceId}?compare=origin` : `paywall/${surfaceId}`,
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

export interface ScreenNextStepsInput {
  studioOpening: boolean;
  superwallDir: string;
  screenPath: string;
  placement: string;
  screenshot: boolean;
  choice: "agent" | "copy" | "later";
}

export function screenNextSteps(input: ScreenNextStepsInput): string[] {
  const review = input.studioOpening
    ? input.screenshot
      ? "The studio opens on the rebuilt screen with the simulator screenshot beside it. Check every state in both schemes."
      : "The studio opens on the rebuilt screen. Keep the original open in the simulator and check every state in both schemes."
    : `Run \`superwall dev\` in ${input.superwallDir} and open the screen${input.screenshot ? "; Compare › Original shows the simulator screenshot" : " next to the original running in the simulator"}. Check every state in both schemes.`;
  return [
    ...(input.choice === "later"
      ? [`superwall migrate --screen ${input.screenPath} — rebuild with your agent, or copy the prompt for one.`]
      : []),
    review,
    "It's your code now: anything that doesn't match, ask your agent to tweak in paywalls/, and the studio reloads live.",
    `Push when it's right, then wire the app: register("${input.placement}") where it presented ${input.screenPath}, a campaign for that placement (\`superwall integrate\` covers it), and delete the native screen.`,
  ];
}
