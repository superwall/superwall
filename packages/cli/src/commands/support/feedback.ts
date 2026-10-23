import { defineCommand } from "@/program/command";
import { FEEDBACK_KINDS } from "@/core/support/feedback/kinds";
import { runFeedback } from "@/core/support/feedback/send";

export const command = defineCommand({
  name: "feedback",
  summary: "Report a bug or send feedback to the Superwall team",
  details:
    "Goes straight to the Superwall team. Pass the app it happened in so the team can find the account. Report anything you confirm doesn't work, as a reproducible report with every ID and version in context. Without a shell, paste the relevant part of a log into the message: a tool cannot attach files.",
  args: {
    message: { describe: "What happened: what you ran, what you expected, what you got (asked when left out)" },
  },
  flags: {
    title: { type: "string", value: "text", describe: "One-line summary" },
    kind: { type: "string", choices: FEEDBACK_KINDS, default: "other", describe: "What this is" },
    command: { type: "string", value: "text", describe: "The command or call that misbehaved" },
    app: { type: "string", value: "id", describe: "The app it happened in (default: this directory's linked app)" },
    project: { type: "string", value: "id", describe: "The project it happened in (default: this directory's linked app)" },
    context: { type: "list", value: "key=value", describe: "Repro context, repeatable: paywall=…, placement=…, sdk=ios@4.5.0, device=…" },
    file: { type: "list", value: "path", mcp: false, describe: "Attach a log or snippet, repeatable, at most 5; - reads stdin; long files keep the last 20k characters" },
    agent: { type: "string", value: "name", describe: "The agent sending it (detected when possible)" },
  },
  examples: [
    ['feedback "migrate crashed on Expo"', "Send feedback"],
    ['feedback "push fails with 413 on a 2MB asset" --title "push 413" --kind bug --command "superwall push" --app <app> --file push.log --json', "For agents: a full bug report"],
  ],
  auth: "optional",
  json: true,
  prompts: true,
  mcp: "write",
  run: (ctx, input) => runFeedback(ctx, input),
});
