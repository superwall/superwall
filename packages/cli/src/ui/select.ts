import type { OutputMode } from "@/program/output";
import { silentRenderer, useRenderer } from "./index";
import { inkRenderer } from "./ink/runtime";
import { plainRenderer } from "./plain/renderer";
import type { Renderer } from "./types";

export function selectRenderer({ mode }: { mode: OutputMode }): Renderer {
  return useRenderer(mode === "rich" ? inkRenderer : mode === "json" ? silentRenderer : plainRenderer);
}
