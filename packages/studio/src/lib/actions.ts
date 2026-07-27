import type { StudioActionName, StudioActionResult, StudioStatus, StudioSurface } from "./types";

export const runAction = async (
  surface: StudioSurface,
  action: StudioActionName,
  onStep?: (step: string, state: "start" | "done") => void,
): Promise<StudioActionResult> => {
  try {
    const response = await fetch("/__studio/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, kind: surface.kind, id: surface.id }),
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
    const response = await fetch(`/__studio/status/${surface.kind}/${surface.id}`);
    return (await response.json()) as StudioStatus;
  } catch {
    return {};
  }
};
