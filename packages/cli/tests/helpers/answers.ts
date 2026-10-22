import type { Renderer } from "@/ui";
import { recordingRenderer, type RendererCall } from "./renderer";

export interface Answers {
  select?: Array<string | null>;
  multiselect?: Array<string[] | null>;
  text?: Array<string | null>;
  confirm?: Array<boolean | null>;
}

export function answeringRenderer(answers: Answers, calls: RendererCall[] = []): Renderer {
  const queues = {
    select: [...(answers.select ?? [])],
    multiselect: [...(answers.multiselect ?? [])],
    text: [...(answers.text ?? [])],
    confirm: [...(answers.confirm ?? [])],
  };
  function take<K extends keyof typeof queues>(method: K, value: { message: string }): (typeof queues)[K][number] {
    calls.push({ method, value });
    const queue = queues[method];
    if (queue.length === 0) throw new Error(`Unexpected ${method}: ${value.message}`);
    return queue.shift() ?? null;
  }
  return {
    ...recordingRenderer(calls),
    select: async (value) => take("select", value),
    multiselect: async (value) => take("multiselect", value),
    text: async (value) => take("text", value),
    confirm: async (value) => take("confirm", value),
  };
}

export function said(calls: RendererCall[], method: string): string[] {
  return calls
    .filter((call) => call.method === method)
    .map((call) => String(call.value ?? "").replace(/\u001B\[[0-9;]*m/g, ""));
}

export function prompted(calls: RendererCall[], method: string): string[] {
  return calls
    .filter((call) => call.method === method)
    .map((call) => String((call.value as { message?: string }).message));
}
