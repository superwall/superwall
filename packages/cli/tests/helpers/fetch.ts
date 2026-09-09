export type Route = {
  match: string | RegExp;
  status?: number;
  body?: unknown;
  text?: string;
  fail?: boolean;
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
      typeof candidate.match === "string" ? url.includes(candidate.match) : candidate.match.test(url),
    );
    if (!route) return new Response("not stubbed", { status: 404 });
    if (route.fail) throw new Error(`offline: ${url}`);
    const payload = route.text ?? JSON.stringify(route.body ?? {});
    return new Response(payload, {
      status: route.status ?? 200,
      headers: { "content-type": route.text === undefined ? "application/json" : "text/plain" },
    });
  }) as typeof fetch;
  return log;
}

export function restoreFetch(): void {
  globalThis.fetch = original;
}
