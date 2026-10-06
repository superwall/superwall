import { surfacePath } from "./preview";
import type {
  Samples,
  StudioActionProgress,
  StudioActionRequest,
  StudioActionResult,
  StudioActions,
  StudioStatus,
  StudioSurface,
} from "./surfaces";

export const runAction = async (
  surface: StudioSurface,
  request: StudioActionRequest,
  onStep?: StudioActionProgress,
): Promise<StudioActionResult> => {
  try {
    const response = await fetch("/__studio/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: request.action,
        version: request.version,
        kind: surface.kind,
        id: surface.id,
        project: surface.project,
      }),
    });
    if (!response.body) {
      return (await response.json()) as StudioActionResult;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let result: StudioActionResult | undefined;

    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as {
        step?: string;
        state?: "start" | "done";
        result?: StudioActionResult;
      };
      if (event.result) result = event.result;
      else if (event.step && event.state) onStep?.(event.step, event.state);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    consume(buffered);

    return result ?? { ok: false, error: "The dev server closed without a result." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const fetchStatus = async (surface: StudioSurface): Promise<StudioStatus> => {
  try {
    const response = await fetch(`/__studio/status${surfacePath(surface)}`);
    return (await response.json()) as StudioStatus;
  } catch (error) {
    return { unreachable: error instanceof Error ? error.message : String(error) };
  }
};

export const devServerActions: StudioActions = {
  offered: ["push", "promote", "publish"],
  run: runAction,
  status: fetchStatus,
};

export const fetchScreenshot = async (surface: StudioSurface): Promise<string | undefined> => {
  const response = await fetch(`/__studio/screenshot${surfacePath(surface)}`);
  const value = (await response.json()) as { url?: string; unreachable?: string };
  if (value.unreachable !== undefined) throw new Error(value.unreachable);
  return value.url;
};

export const fetchSamples = async (): Promise<Samples> => {
  try {
    const response = await fetch("/__studio/samples.json");
    const value: unknown = await response.json();
    return typeof value === "object" && value !== null ? (value as Samples) : {};
  } catch (error) {
    return { unreachable: error instanceof Error ? error.message : String(error) };
  }
};
