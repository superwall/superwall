export type Route = {
  match: string | RegExp;
  status?: number;
  body?: unknown;
  text?: string;
  fail?: boolean;
  stall?: boolean;
  stallBody?: boolean;
};

export type FetchLog = { url: string; method: string; body?: string }[];

const original = globalThis.fetch;

export function useFetch(routes: Route[]): FetchLog {
  const log: FetchLog = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(typeof input === "object" && "url" in input ? input.url : input);
    log.push({
      url,
      method: init?.method ?? "GET",
      ...(init?.body === undefined ? {} : { body: String(init.body) }),
    });
    const route = routes.find((candidate) =>
      typeof candidate.match === "string"
        ? url.includes(candidate.match)
        : candidate.match.test(url),
    );
    if (!route) return new Response("not stubbed", { status: 404 });
    if (route.fail) throw new Error(`offline: ${url}`);
    if (route.stall) return stalled(init?.signal);
    if (route.stallBody)
      return new Response(stalledBody(init?.signal), { status: route.status ?? 200 });
    const payload = route.text ?? JSON.stringify(route.body ?? {});
    return new Response(payload, {
      status: route.status ?? 200,
      headers: { "content-type": route.text === undefined ? "application/json" : "text/plain" },
    });
  }) as typeof fetch;
  return log;
}

function stalled(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    const hold = setTimeout(() => reject(new Error("the request carried no deadline")), 5_000);
    signal?.addEventListener("abort", () => {
      clearTimeout(hold);
      reject(signal.reason);
    });
  });
}

function stalledBody(signal: AbortSignal | null | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"access_token":'));
      const hold = setTimeout(
        () => controller.error(new Error("the body carried no deadline")),
        5_000,
      );
      signal?.addEventListener("abort", () => {
        clearTimeout(hold);
        controller.error(signal.reason);
      });
    },
  });
}

export function restoreFetch(): void {
  globalThis.fetch = original;
}
