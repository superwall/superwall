import { stripAnsi } from "@/ui/ansi";
import type { ListOpts, Renderer } from "@/ui/types";

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export type OutputMode = "rich" | "text" | "json";

type OutputBlock =
  | { kind: "intro"; text: string }
  | { kind: "step"; text: string }
  | { kind: "info"; text: string }
  | { kind: "success"; text: string }
  | { kind: "warning"; text: string }
  | { kind: "report"; text: string }
  | { kind: "list"; value: ListOpts }
  | { kind: "nextSteps"; items: string[] }
  | { kind: "outro"; text: string };

export const blocks = {
  intro: (text: string): OutputBlock => ({ kind: "intro", text }),
  step: (text: string): OutputBlock => ({ kind: "step", text }),
  info: (text: string): OutputBlock => ({ kind: "info", text }),
  success: (text: string): OutputBlock => ({ kind: "success", text }),
  warning: (text: string): OutputBlock => ({ kind: "warning", text }),
  report: (text: string): OutputBlock => ({ kind: "report", text }),
  list: (value: ListOpts): OutputBlock => ({ kind: "list", value }),
  nextSteps: (items: string[]): OutputBlock => ({ kind: "nextSteps", items }),
  outro: (text: string): OutputBlock => ({ kind: "outro", text }),
};

export interface CommandOutput {
  readonly mode: OutputMode;
  data(value: unknown): void;
  text(value: string): void;
  render(...blocks: OutputBlock[]): void;
}

interface OutputStreams {
  stdout: Pick<NodeJS.WriteStream, "write">;
}

export function writeJson(stream: Pick<NodeJS.WriteStream, "write">, value: unknown): void {
  stream.write(`${formatJson(value)}\n`);
}

export function createCommandOutput(
  mode: OutputMode,
  renderer: Renderer,
  streams: OutputStreams = { stdout: process.stdout },
): CommandOutput {
  return {
    mode,
    data(value) {
      if (mode === "json") writeJson(streams.stdout, value);
      else renderer.report(formatJson(value));
    },
    text(value) {
      if (mode === "json")
        throw new Error("This command must return structured JSON in --json mode.");
      const text = value.replace(/\n$/, "");
      renderer.report(mode === "text" ? stripAnsi(text) : text);
    },
    render(...blocks) {
      if (mode === "json") return;
      for (const block of blocks) renderBlock(renderer, block);
    },
  };
}

function renderBlock(renderer: Renderer, block: OutputBlock): void {
  switch (block.kind) {
    case "intro":
      return renderer.intro(block.text);
    case "step":
      return renderer.step(block.text);
    case "info":
      return renderer.info(block.text);
    case "success":
      return renderer.success(block.text);
    case "warning":
      return renderer.warn(block.text);
    case "report":
      return renderer.report(block.text);
    case "list":
      return renderer.list(block.value);
    case "nextSteps":
      if (block.items.length)
        renderer.note(
          block.items.map((item, index) => `${index + 1}. ${item}`).join("\n"),
          "Next steps",
        );
      return;
    case "outro":
      return renderer.outro(block.text);
  }
}
