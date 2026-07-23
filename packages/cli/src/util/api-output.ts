import type { CommandContext } from "@/command";

export function emitJson(ctx: CommandContext, data: unknown): void {
  ctx.output.data(data);
}

export async function apiCall<T>(
  ctx: CommandContext,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  if (ctx.outputMode !== "rich") return work();
  const spin = ctx.ui.spinner();
  spin.start(label);
  try {
    const result = await work();
    spin.stop(label);
    return result;
  } catch (e) {
    spin.stop("Failed");
    throw e;
  }
}
