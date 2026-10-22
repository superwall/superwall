import { type CommandContext } from "@/program/command";
import { ui } from "./index";

type Spinner = ReturnType<typeof ui.spinner>;

async function spinWhile<T>(spin: Spinner, label: string, work: () => Promise<T>): Promise<T> {
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

export function withSpinner<T>(label: string, work: () => Promise<T>): Promise<T> {
  return spinWhile(ui.spinner(), label, work);
}

export function apiCall<T>(ctx: CommandContext, label: string, work: () => Promise<T>): Promise<T> {
  if (ctx.outputMode !== "rich") return work();
  return spinWhile(ctx.ui.spinner(), label, work);
}
