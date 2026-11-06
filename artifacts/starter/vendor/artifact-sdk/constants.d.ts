// Generated from packages/artifact-sdk by its vendor script. Do not edit.
/**
 * The constants a customer's vendored SDK carries: the wire contract between
 * customer code, the host and the platform. No imports, so `./server` and
 * `./client` stay out of Effect and keep customer bundles small. The platform's
 * own helpers live in `constants.ts`, which re-exports all of this.
 */
/** Trusted header carrying the bound slot context (JSON) to customer code. */
export declare const CONTEXT_HEADER = "x-superwall-artifact-context";
/** Trusted header naming the entrypoint being served. */
export declare const ENTRYPOINT_HEADER = "x-superwall-artifact-entrypoint";
/** Trusted header naming the trigger. */
export declare const TRIGGER_HEADER = "x-superwall-artifact-trigger";
/** Virtual host the outbound Worker serves for storage, jobs and logs. */
export declare const PLATFORM_HOST = "platform.artifact.internal";
/**
 * Virtual host for the Superwall API. The outbound Worker maps it to the
 * stage's API origin and attaches the artifact token.
 */
export declare const API_HOST = "api.artifact.internal";
/** Routes only the platform may call. The dispatcher drops them from public traffic. */
export declare const INTERNAL_PATH_PREFIX = "/__sw/";
/**
 * Judged the way a lenient customer router might see the path: decoded,
 * case-folded and with repeated slashes collapsed, so `/%5F%5Fsw`, `/__SW` and
 * `//__sw` are internal too. A path that fails to decode is treated as internal.
 */
export declare const isInternalPath: (pathname: string) => boolean;
export declare const BRIDGE_PROTOCOL = "superwall-artifact@1";
/** How long the host waits for `ready` before showing the load error. */
export declare const MOUNT_LOAD_TIMEOUT_MS = 20000;
/** Where the dashboard is served from: production, then staging. Nothing else may frame an artifact. */
export declare const DASHBOARD_ORIGINS: ReadonlyArray<string>;
/**
 * The date every loaded bundle runs on, whatever its wrangler config says, until
 * the builder records each bundle's own.
 */
export declare const ARTIFACT_COMPATIBILITY_DATE = "2026-09-01";
/** Where an artifact serves its browser bundle. Its files are named by their hash. */
export declare const CLIENT_ASSET_PREFIX = "/_client/";
/**
 * What a Worker imports to get its browser bundle. It has types and no code: the
 * build substitutes the bundle it made from the manifest's `client.entry`, so a
 * Worker importing this with no `client` declared doesn't bundle.
 */
export declare const CLIENT_BUNDLE_MODULE = "@superwall/artifact-sdk/client-bundle";
/** The esbuild that bundles an artifact's browser code, everywhere: the builder and `dev`. */
export declare const CLIENT_ESBUILD_VERSION = "0.28.2";
/** The browser bundle's script and styles together. It travels inside the Worker's bundle, which has code of its own. */
export declare const CLIENT_BUNDLE_MAX_BYTES: number;
/** What the platform accepts from a `metric` handler. */
export declare const METRIC_LIMITS: {
    /** Points across every series. */
    readonly maxPoints: 5000;
    /** Distinct breakdown values, `null` included. */
    readonly maxSeries: 50;
    /** The serialized series. */
    readonly maxBytes: 262144;
    /** How long the platform waits for the handler. */
    readonly timeoutMs: 10000;
};
/** What the platform accepts from a `readout` handler. */
export declare const READOUT_LIMITS: {
    /** The serialized answer. */
    readonly maxBytes: 32768;
    /** How long the platform waits for the handler. */
    readonly timeoutMs: 10000;
};
