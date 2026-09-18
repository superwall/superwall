/**
 * Hosts this surface is allowed to reach over the network.
 *
 * A published surface runs under a Content-Security-Policy the platform
 * enforces at serve time, and by default it may only talk to Superwall and
 * Stripe. Anything else — a customer's own API, a lead-capture endpoint, a
 * custom analytics collector — has to be named here, or the browser refuses
 * the request before it reaches the network.
 *
 * The allowlist is deliberately narrow rather than absent. The policy permits
 * `unsafe-eval` and `blob:` scripts (the bundler output needs both), so the
 * set of reachable hosts is what keeps a published surface from fetching and
 * evaluating code nobody reviewed. An open policy would make the bytes that
 * run unknowable; a named host keeps them attributable.
 *
 * Write bare hostnames — `https` is implied and enforced:
 *
 * ```ts
 * export default definePaywall({
 *   allowedHosts: ["api.example.com"],
 * });
 * ```
 *
 * A full `https://` origin is accepted too and normalizes to the same thing,
 * so pasting a URL from a fetch call does the expected thing.
 */
export type SuperwallAllowedHostsConfig = readonly string[];

export type ResolvedAllowedHosts = {
  /** CSP source expressions, `https://host[:port]`, deduped and sorted. */
  origins: string[];
  /** Entries that could not be read as a host, verbatim, in input order. */
  invalid: string[];
};

/**
 * How many hosts one surface may name. Not a technical ceiling — a surface
 * reaching more than a handful of origins is usually a sign the work belongs
 * on a backend, and every entry widens the policy for every shopper.
 */
export const MAX_ALLOWED_HOSTS = 20;

/**
 * Host plus optional port. Deliberately strict: no scheme (stripped before
 * this runs), no userinfo, no path, no query, no wildcard. A wildcard would
 * re-open the hole the allowlist exists to close, and `*.example.com` is not
 * reviewable — the point is naming the host you actually call.
 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

/**
 * The loopback interface, which is never a valid entry.
 *
 * Not a security judgement so much as an arithmetic one: a pushed paywall
 * runs on somebody else's device, where `localhost` is *their* machine, not
 * the developer's. An entry naming it can only ever widen the policy for
 * every shopper in exchange for a request that cannot succeed.
 *
 * Local development does not need it either — `superwall dev` serves the
 * surface with no policy at all, so a `fetch` to a local API works there
 * whether or not it is named here. To exercise a local API from a *pushed*
 * build, put it behind an https tunnel and name that hostname.
 *
 * Detected only to say so plainly; see `allowedHostsWire`.
 */
export const LOOPBACK_HOST = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?\/?$/;

const originOf = (entry: string): string | undefined => {
  const trimmed = entry.trim().toLowerCase();
  if (trimmed === "") return undefined;

  const withoutSlash = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;

  // https only, everywhere, with no exception — a served policy should never
  // be able to carry a plaintext origin. `http://` is refused rather than
  // upgraded: silently rewriting it would produce an origin the author did
  // not ask for and every request against it would fail unexplained.
  if (LOOPBACK_HOST.test(withoutSlash)) return undefined;

  // A pasted `https://api.example.com` and a bare `api.example.com` mean the
  // same thing. Anything else with a scheme is a mistake worth surfacing.
  const host = withoutSlash.startsWith("https://")
    ? withoutSlash.slice("https://".length)
    : withoutSlash;

  if (!HOST_PATTERN.test(host)) return undefined;
  return `https://${host}`;
};

/**
 * Total by design — it never throws, so a malformed entry cannot white-screen
 * a paywall at runtime. Rejects are returned rather than dropped so the build
 * can fail loudly instead, which is the only moment anyone is looking.
 */
export const allowedHostsOf = (
  allowedHosts: SuperwallAllowedHostsConfig | undefined,
): ResolvedAllowedHosts => {
  if (allowedHosts === undefined) return { origins: [], invalid: [] };

  const origins = new Set<string>();
  const invalid: string[] = [];

  for (const entry of allowedHosts) {
    const origin = typeof entry === "string" ? originOf(entry) : undefined;
    if (origin === undefined) {
      invalid.push(String(entry));
      continue;
    }
    origins.add(origin);
  }

  // Sorted so the same config always produces the same wire bytes, whatever
  // order the author listed them in.
  return { origins: [...origins].sort(), invalid };
};
