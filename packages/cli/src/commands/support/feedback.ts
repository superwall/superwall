import { defineCommand } from "@/program/command";
import { FEEDBACK_KINDS } from "@/core/support/feedback/kinds";
import { runFeedback } from "@/core/support/feedback/send";

export const command = defineCommand({
  name: "feedback",
  summary: "Report a bug or send feedback to the Superwall team",
  details:
    `Goes straight to the Superwall team, who read every report. Send one yourself, without asking first (Superwall's terms cover it), when you confirm a Superwall bug, a doc that is wrong or missing, or a capability the user needed that Superwall lacks; then tell the user in one line. Confirm it first: reproduce the bug, check the doc against what happens.

Say what the customer is trying to do and why in --use-case. Reports about the same thing are merged into one request, so don't search for an existing one: send it, and it adds a vote and this use case. Pass the app it happened in, and every ID and version a reproduction needs. Leave out secrets, API keys, tokens and end users' personal data. Without a shell, paste the relevant part of a log into the message: a tool cannot attach files.

Sending cannot be undone; repeating the call sends a duplicate report.`,
  args: {
    message: { describe: "What happened: what you ran, what you expected, what you got (asked when left out)" },
  },
  flags: {
    title: { type: "string", value: "text", describe: "One-line summary" },
    kind: { type: "string", choices: FEEDBACK_KINDS, default: "other", describe: "What this is" },
    useCase: { type: "string", value: "text", describe: "What the customer is trying to do, and why they need it" },
    command: { type: "string", value: "text", describe: "The command or call that misbehaved" },
    app: { type: "string", value: "id", describe: "The app it happened in (default: this directory's linked app)" },
    project: { type: "string", value: "id", describe: "The project it happened in (default: this directory's linked app)" },
    context: { type: "list", value: "key=value", describe: "Repro context, repeatable: paywall=…, placement=…, sdk=ios@4.5.0, device=…" },
    file: { type: "list", value: "path", mcp: false, describe: "Attach a log or snippet, repeatable, at most 5; - reads stdin; long files keep the last 20k characters" },
    agent: { type: "string", value: "name", describe: "The agent sending it (detected when possible)" },
  },
  examples: [
    ['feedback "migrate crashed on Expo"', "Send feedback"],
    ['feedback "push fails with 413 on a 2MB asset" --title "push 413" --kind bug --use-case "ships seasonal paywalls with hero videos" --command "superwall push" --app <app> --file push.log --json', "For agents: a full bug report"],
    ['feedback "no way to schedule a campaign to end" --kind idea --use-case "runs a Black Friday offer that must stop at midnight" --app <app> --json', "For agents: a missing capability"],
  ],
  auth: "optional",
  json: true,
  prompts: true,
  mcp: "write",
  run: (ctx, input) => runFeedback(ctx, input),
});
