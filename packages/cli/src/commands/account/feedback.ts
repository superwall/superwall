import { defineCommand } from "@/command";
import { submitFeedback } from "@/core/feedback";

export const runFeedback = defineCommand({
  name: "feedback",
  output: "both",
  async run(ctx) {
    const { ui, json, interactive, argv } = ctx;
    let message = (argv.message as string | undefined)?.trim();

    if (!message && interactive) {
      ui.intro("Superwall feedback");
      const answer = await ui.text({
        message: "What's your feedback on the Superwall CLI?",
        placeholder: "What worked, what didn't, what's missing...",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (answer === null) return void ui.warn("Cancelled.");
      message = answer.trim();
    }
    if (!message) {
      throw new Error('Usage: superwall feedback "<message>"');
    }

    const via = interactive ? "human" : "agent";
    const spin = interactive ? ui.spinner() : null;
    spin?.start("Sending your feedback");
    const ok = await submitFeedback(message, via);
    spin?.stop(ok ? "Sent" : "Failed to send");

    if (json) return ctx.output.data({ submitted: ok });
    if (!ok) {
      throw new Error("Couldn't send your feedback - check your connection and try again.");
    }
    ui.success(
      "Thank you! We've received your feedback and will read through it. Really appreciate you helping us make the CLI better.",
    );
  },
});
