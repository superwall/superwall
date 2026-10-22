import { defineCommand } from "@/program/command";
import { FEEDBACK_KINDS } from "@/core/support/feedback/kinds";

export const command = defineCommand({
  name: "feedback",
  summary: "Report a bug or send feedback to the Superwall team",
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
    file: { type: "list", value: "path", describe: "Attach a log or snippet, repeatable, at most 5; - reads stdin; long files keep the last 20k characters" },
    agent: { type: "string", value: "name", describe: "The agent sending it (detected when possible)" },
  },
  examples: [
    ['feedback "migrate crashed on Expo"', "Send feedback"],
    ['feedback "push fails with 413 on a 2MB asset" --title "push 413" --kind bug --command "superwall push" --app <app> --file push.log --json', "For agents: a full bug report"],
  ],
  auth: "optional",
  json: true,
  prompts: true,
  mcp: false,
  async run(ctx, input) {
    const { runFeedback } = await import("@/core/support/feedback/send");
    return runFeedback(ctx, input);
  },
});
