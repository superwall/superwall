import { defineCommand } from "@/command";
import { requireApi } from "@/core/paywalls/project/session";
import { runPushPipeline } from "./pipeline";

export const runPublish = defineCommand({
  name: "publish",
  output: "human",
  async run(context) {
    const api = await requireApi(context.interactive);
    await runPushPipeline({ ...context, api }, { promote: true });
  },
});
