import { WorkspaceError } from "./project";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDeclared = (value: unknown): boolean => {
  if (value === undefined || value === null || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.values(value).some(isDeclared);
  return true;
};

const REFUSED_KEYS: readonly (readonly [keys: readonly string[], message: string])[] = [
  [
    ["durable_objects", "migrations", "exports"],
    "Durable Objects are not supported in workspaces: platform storage is reached through fetch.",
  ],
  [["workflows"], "Workflows are not supported in workspaces."],
  [["containers", "cloudchamber"], "Containers are not supported in workspaces."],
  [
    ["vars", "secrets"],
    "Environment variables and secrets are not supported in the wrangler config: declare secrets in superwall.json.",
  ],
  [
    ["definedEnvironments", "targetEnvironment"],
    "Wrangler environments are not supported in workspaces: a workspace has one config, with no `env` section.",
  ],
  [
    [
      "kv_namespaces",
      "r2_buckets",
      "d1_databases",
      "queues",
      "services",
      "send_email",
      "vectorize",
      "ai",
      "ai_search",
      "ai_search_namespaces",
      "hyperdrive",
      "analytics",
      "analytics_engine_datasets",
      "browser",
      "images",
      "media",
      "stream",
      "version_metadata",
      "unsafe",
      "unsafe_hello_world",
      "mtls_certificates",
      "tail_consumers",
      "streaming_tail_consumers",
      "dispatch_namespaces",
      "pipelines",
      "secrets_store_secrets",
      "artifacts",
      "flagship",
      "ratelimits",
      "worker_loaders",
      "vpc_services",
      "vpc_networks",
      "logfwdr",
      "assets",
      "agent_memory",
      "k2",
      "connect",
      "wasm_modules",
      "text_blobs",
      "data_blobs",
    ],
    "Bindings are not supported in workspaces: a workspace reaches everything through fetch.",
  ],
  [
    ["no_bundle", "find_additional_modules", "base_dir", "preserve_file_names", "rules"],
    "A workspace is one bundled module: remove these and let the builder bundle `main`.",
  ],
  [
    ["site", "pages_build_output_dir", "addresses", "access", "cache", "previews", "first_party_worker"],
    "The platform serves a workspace, so these Worker settings don't apply.",
  ],
];

const ALLOWED_KEYS = [
  "$schema",
  "name",
  "main",
  "compatibility_date",
  "compatibility_flags",
  "configPath",
  "userConfigPath",
  "topLevelName",
  "build",
  "triggers",
  "define",
  "alias",
  "jsx_factory",
  "jsx_fragment",
  "minify",
  "keep_names",
  "tsconfig",
  "python_modules",
  "dependencies_instrumentation",
  "account_id",
  "route",
  "routes",
  "workers_dev",
  "preview_urls",
  "observability",
  "logpush",
  "upload_source_maps",
  "send_metrics",
  "limits",
  "placement",
  "compliance_region",
  "keep_vars",
  "dev",
];

export const KNOWN_WRANGLER_KEYS: ReadonlySet<string> = new Set([
  ...ALLOWED_KEYS,
  ...REFUSED_KEYS.flatMap(([keys]) => keys),
]);

const COMPATIBILITY_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_COMPATIBILITY_DATE = "2024-09-23";
const COMPATIBILITY_FLAGS: ReadonlySet<unknown> = new Set(["nodejs_compat", "nodejs_compat_v2", "nodejs_als"]);

function builderProblem(config: unknown): string | undefined {
  if (!isRecord(config)) return "No wrangler config (wrangler.jsonc, wrangler.json or wrangler.toml) was found.";
  for (const [keys, message] of REFUSED_KEYS) {
    const found = keys.filter((key) => isDeclared(config[key]));
    if (found.length > 0) return `${message} (found: ${found.join(", ")})`;
  }
  const unknown = Object.keys(config).filter((key) => !KNOWN_WRANGLER_KEYS.has(key) && isDeclared(config[key]));
  if (unknown.length > 0) return `The wrangler config has keys the builder doesn't support (found: ${unknown.join(", ")}).`;
  if (isRecord(config.triggers) && isDeclared(config.triggers.crons)) {
    return "Cron triggers belong in superwall.json (`crons`), not the wrangler config.";
  }
  if (isRecord(config.build) && isDeclared(config.build.command)) {
    return "Custom build commands are not supported: the builder bundles `main` with wrangler.";
  }
  if (typeof config.main !== "string" || config.main.length === 0) return "The wrangler config needs a `main` entry point.";
  if (typeof config.compatibility_date !== "string" || !COMPATIBILITY_DATE.test(config.compatibility_date)) {
    return "The wrangler config needs a compatibility_date (YYYY-MM-DD).";
  }
  const today = new Date().toISOString().slice(0, 10);
  if (config.compatibility_date < MIN_COMPATIBILITY_DATE || config.compatibility_date > today) {
    return `compatibility_date must be between ${MIN_COMPATIBILITY_DATE} and today (found: ${config.compatibility_date}).`;
  }
  const flags: readonly unknown[] = Array.isArray(config.compatibility_flags) ? config.compatibility_flags : [];
  const refused = flags.filter((flag) => !COMPATIBILITY_FLAGS.has(flag));
  if (refused.length > 0) {
    return `These compatibility_flags are not supported in workspaces: ${refused.join(", ")}. Allowed: ${[...COMPATIBILITY_FLAGS].join(", ")}.`;
  }
  return undefined;
}

export function assertBuilderAccepts(config: unknown): void {
  const problem = builderProblem(config);
  if (problem !== undefined) throw new WorkspaceError(`This would fail on the builder. ${problem}`);
}

const isOutsideRepo = (input: string): boolean =>
  input === ".." || input.startsWith("../") || input.startsWith("/") || input === ".git" || input.startsWith(".git/");

const INPUTS_SHOWN = 5;

export function outsideRepoProblem(inputs: readonly string[]): string | undefined {
  if (inputs.length === 0) return undefined;
  const shown = inputs.slice(0, INPUTS_SHOWN).join(", ");
  const more = inputs.length > INPUTS_SHOWN ? ` and ${inputs.length - INPUTS_SHOWN} more` : "";
  return `The bundle reads files outside the repo, which isn't allowed: ${shown}${more}.`;
}

export const workerInputsOutside = (inputs: readonly string[], toolchain: (input: string) => boolean): string[] =>
  inputs.filter((input) => isOutsideRepo(input) && !toolchain(input));
