import { defineCommand } from "@/command";
import { requireApi } from "@/core/paywalls/session";
import { runPushPipeline } from "./paywalls/pipeline";

export const runPublish = defineCommand({
  name: "publish",
  output: "human",
  async run(context) {
    const api = await requireApi(context.interactive);
    await runPushPipeline({ ...context, api }, { promote: true });
  },
});
