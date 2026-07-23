import type { Renderer } from "@/ui";

export interface RendererCall {
  method: string;
  value?: unknown;
}

export function recordingRenderer(calls: RendererCall[] = []): Renderer {
  const record = (method: string, value?: unknown) => calls.push({ method, value });
  return {
    start: () => record("start"),
    stop: () => record("stop"),
    intro: (value) => record("intro", value),
    step: (value) => record("step", value),
    info: (value) => record("info", value),
    success: (value) => record("success", value),
    warn: (value) => record("warn", value),
    error: (value) => record("error", value),
    note: (value, title) => record("note", { value, title }),
    report: (value) => record("report", value),
    list: (value) => record("list", value),
    outro: (value) => record("outro", value),
    spinner: () => ({
      start: (value) => record("spinner.start", value),
      message: (value) => record("spinner.message", value),
      stop: (value) => record("spinner.stop", value),
    }),
    select: async (value) => (record("select", value), null),
    multiselect: async (value) => (record("multiselect", value), null),
    confirm: async (value) => (record("confirm", value), null),
    text: async (value) => (record("text", value), null),
  };
}
