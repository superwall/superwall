import { defineCommand } from "@/command";
import { requireApi } from "@/core/paywalls/session";
import { runPushPipeline } from "./paywalls/pipeline";

export const runPush = defineCommand({
  name: "push",
  output: "human",
  async run(context) {
    const api = await requireApi(context.interactive);
    await runPushPipeline({ ...context, api }, { promote: false });
  },
});
