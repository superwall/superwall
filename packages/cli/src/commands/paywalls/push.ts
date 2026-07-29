import { defineCommand } from "@/command";
import { requireApi } from "@/core/paywalls/project/session";
import { runPushPipeline } from "./pipeline";

export const runPush = defineCommand({
  name: "push",
  output: "human",
  async run(context) {
    const api = await requireApi(context.interactive);
    await runPushPipeline({ ...context, api }, { promote: false });
  },
});
