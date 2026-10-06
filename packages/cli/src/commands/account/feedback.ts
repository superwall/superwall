import { defineCommand } from "@/command";
import {
  detectAgent,
  FEEDBACK_KINDS,
  type FeedbackKind,
  linkedApp,
  parseContext,
  readAttachments,
  submitFeedback,
} from "@/core/feedback";

export const runFeedback = defineCommand({
  name: "feedback",
  output: "both",
  async run(ctx) {
    const { ui, json, interactive, argv } = ctx;
    let message = (argv.message as string | undefined)?.trim();

    if (!message && interactive) {
      ui.intro("Superwall feedback");
      const answer = await ui.text({
        message: "What's your feedback on Superwall?",
        placeholder: "What worked, what didn't, what's missing...",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (answer === null) return void ui.warn("Cancelled.");
      message = answer.trim();
    }
    if (!message) {
      throw new Error(
        'Usage: superwall feedback "<message>" [--title ...] [--kind bug] [--file log.txt]',
      );
    }

    const kind = (argv.kind as FeedbackKind | undefined) ?? "other";
    if (!FEEDBACK_KINDS.includes(kind)) {
      throw new Error(`--kind must be one of: ${FEEDBACK_KINDS.join(", ")}`);
    }
    const agent = (argv.agent as string | undefined)?.trim() || detectAgent();
    const attachments = readAttachments(
      ([] as unknown[])
        .concat(argv.file ?? [])
        .map(String)
        .filter(Boolean),
    );

    const context = parseContext(([] as unknown[]).concat(argv.context ?? []).map(String));
    const linked = linkedApp();

    const via = agent || !interactive ? "agent" : "human";
    const spin = interactive ? ui.spinner() : null;
    spin?.start("Sending your feedback");
    const ok = await submitFeedback(
      {
        title: (argv.title as string | undefined)?.trim() || undefined,
        message,
        kind,
        command: (argv.command as string | undefined)?.trim() || undefined,
        agent,
        projectId: (argv.project as string | undefined) ?? linked.projectId,
        applicationId: (argv.app as string | undefined) ?? linked.applicationId,
        context,
        attachments,
      },
      via,
    );
    spin?.stop(ok ? "Sent" : "Failed to send");

    if (json) return ctx.output.data({ submitted: ok });
    if (!ok) {
      throw new Error("Couldn't send your feedback - check your connection and try again.");
    }
    ui.success(
      "Thank you! We've received your feedback and will read through it. Really appreciate you helping us make Superwall better.",
    );
  },
});
