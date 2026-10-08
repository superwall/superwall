export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
}

export interface CookieJar {
  store(url: URL, setCookie: readonly string[]): void;
  header(url: URL): string | undefined;
  snapshot(): StoredCookie[];
}

function parse(url: URL, line: string): { cookie: StoredCookie; expired: boolean } | undefined {
  const [pair = "", ...attributes] = line.split(";");
  const separator = pair.indexOf("=");
  if (separator <= 0) return undefined;
  const cookie: StoredCookie = {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    domain: url.hostname.toLowerCase(),
    hostOnly: true,
    path: "/",
  };
  let expired = false;
  for (const attribute of attributes) {
    const split = attribute.indexOf("=");
    const key = (split === -1 ? attribute : attribute.slice(0, split)).trim().toLowerCase();
    const value = split === -1 ? "" : attribute.slice(split + 1).trim();
    if (key === "domain" && value) {
      cookie.domain = value.replace(/^\./, "").toLowerCase();
      cookie.hostOnly = false;
    } else if (key === "path" && value.startsWith("/")) {
      cookie.path = value;
    } else if (key === "max-age" && Number(value) <= 0) {
      expired = true;
    } else if (key === "expires") {
      const at = Date.parse(value);
      if (!Number.isNaN(at) && at <= Date.now()) expired = true;
    }
  }
  return { cookie, expired };
}

function matches(cookie: StoredCookie, url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const domainMatch = cookie.hostOnly
    ? host === cookie.domain
    : host === cookie.domain || host.endsWith(`.${cookie.domain}`);
  if (!domainMatch) return false;
  if (cookie.path === "/") return true;
  return url.pathname === cookie.path || url.pathname.startsWith(`${cookie.path.replace(/\/$/, "")}/`);
}

export function createCookieJar(initial: readonly StoredCookie[] = []): CookieJar {
  let cookies = [...initial];
  const same = (a: StoredCookie, b: StoredCookie) =>
    a.name === b.name && a.domain === b.domain && a.path === b.path;
  return {
    store(url, setCookie) {
      for (const line of setCookie) {
        const parsed = parse(url, line);
        if (!parsed) continue;
        cookies = cookies.filter((existing) => !same(existing, parsed.cookie));
        if (!parsed.expired) cookies.push(parsed.cookie);
      }
    },
    header(url) {
      const sent = cookies.filter((cookie) => matches(cookie, url));
      return sent.length === 0
        ? undefined
        : sent.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    },
    snapshot: () => cookies.map((cookie) => ({ ...cookie })),
  };
}
