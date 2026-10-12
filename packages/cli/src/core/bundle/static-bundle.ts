import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

export const BUNDLE_NAME = "Superwall.bundle";
export const BUNDLE_MANIFEST = "bundle.json";
export const BUNDLE_CONFIG = "static_config.json";
export const BUNDLE_VERSION = 1;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface PaywallResponse {
  id?: number | string;
  identifier: string;
  url: string;
  url_config?: { endpoints?: { url: string }[] };
}

interface TriggerOption {
  event_name: string;
  rules?: { variants?: { paywall_identifier?: string | null }[] }[];
}

export interface StaticConfig {
  paywall_responses?: PaywallResponse[];
  trigger_options?: TriggerOption[];
}

export interface Selection {
  placements: string[];
  paywalls: string[];
  all: boolean;
}

export interface BundledFile {
  url: string;
  file: string;
  mimeType: string;
}

export interface BundledPaywall {
  identifier: string;
  urls: string[];
  document: BundledFile;
  resources: BundledFile[];
}

export interface BundleManifest {
  version: number;
  createdAt: string;
  buildId?: string;
  paywalls: BundledPaywall[];
}

export interface BundleResult {
  out: string;
  manifest: BundleManifest;
  bytes: number;
}

const ASSET_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico",
  "mp4", "webm", "mov", "m4v", "mp3", "m4a", "aac", "wav", "ogg",
  "woff", "woff2", "ttf", "otf",
  "json", "riv", "lottie", "css", "js",
];

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  json: "application/json",
  riv: "application/octet-stream",
  lottie: "application/zip",
  css: "text/css",
  js: "text/javascript",
  html: "text/html",
};

const REMOTE_ASSET = new RegExp(
  `https?:\\/\\/[^\\s"'\`()<>\\\\{}|^]+?\\.(?:${ASSET_EXTENSIONS.join("|")})(?:\\?[^\\s"'\`()<>\\\\{}|^]*)?(?=[\\s"'\`()<>\\\\,;]|$)`,
  "gi",
);

export async function fetchStaticConfig(
  apiKey: string,
  { apiUrl, fetch: fetchImpl = fetch }: { apiUrl: string; fetch?: Fetch },
): Promise<{ raw: string; config: StaticConfig & { build_id?: string } }> {
  const url = `${apiUrl.replace(/\/+$/, "")}/api/v1/static_config?pk=${encodeURIComponent(apiKey)}`;
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Platform": "iOS",
      "X-Platform-Environment": "SDK",
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `Fetching the static config failed with HTTP ${response.status}. Check the public API key belongs to the app you are bundling.`,
    );
  }
  return { raw, config: JSON.parse(raw) as StaticConfig & { build_id?: string } };
}

export function selectPaywalls(config: StaticConfig, selection: Selection): PaywallResponse[] {
  const paywalls = config.paywall_responses ?? [];
  if (selection.all) return paywalls;

  if (selection.placements.length === 0 && selection.paywalls.length === 0) {
    throw new Error("Choose what to bundle: --placement <name>, --paywall <identifier>, or --all.");
  }

  const wanted = new Set<string>();
  const triggers = config.trigger_options ?? [];
  for (const placement of selection.placements) {
    const trigger = triggers.find((t) => t.event_name === placement);
    if (!trigger) {
      const known = triggers.map((t) => t.event_name).join(", ") || "none";
      throw new Error(`No campaign carries the placement "${placement}". Placements in this app: ${known}.`);
    }
    for (const rule of trigger.rules ?? []) {
      for (const variant of rule.variants ?? []) {
        if (variant.paywall_identifier) wanted.add(variant.paywall_identifier);
      }
    }
  }
  for (const requested of selection.paywalls) {
    const match = paywalls.find((p) => p.identifier === requested || String(p.id) === requested);
    if (!match) {
      const known = paywalls.map((p) => p.identifier).join(", ") || "none";
      throw new Error(`The static config has no paywall "${requested}". Paywalls in this app: ${known}.`);
    }
    wanted.add(match.identifier);
  }

  const selected = paywalls.filter((p) => wanted.has(p.identifier));
  const missing = [...wanted].filter((id) => !selected.some((p) => p.identifier === id));
  if (missing.length > 0) {
    throw new Error(`The static config is missing the paywall response for: ${missing.join(", ")}.`);
  }
  return selected;
}

export function findRemoteAssets(document: string): string[] {
  const found = new Set<string>();
  for (const match of document.matchAll(REMOTE_ASSET)) {
    found.add(match[0].replace(/&amp;/g, "&"));
  }
  return [...found];
}

function mimeTypeFor(url: string, header: string | null): string {
  const declared = header?.split(";")[0]?.trim();
  if (declared && declared !== "application/octet-stream" && declared !== "binary/octet-stream") {
    return declared;
  }
  const extension = extname(new URL(url).pathname).slice(1).toLowerCase();
  return MIME_TYPES[extension] ?? declared ?? "application/octet-stream";
}

function fileNameFor(url: string, data: Buffer): string {
  const extension = extname(new URL(url).pathname).toLowerCase() || ".bin";
  return `files/${createHash("sha256").update(data).digest("hex")}${extension}`;
}

async function download(
  url: string,
  fetchImpl: Fetch,
): Promise<{ data: Buffer; mimeType: string }> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return {
    data: Buffer.from(await response.arrayBuffer()),
    mimeType: mimeTypeFor(url, response.headers.get("content-type")),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function prepareOut(out: string): void {
  if (existsSync(out)) {
    if (!existsSync(join(out, BUNDLE_MANIFEST))) {
      throw new Error(`${out} exists and is not a Superwall bundle. Choose another --out or remove it.`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(join(out, "files"), { recursive: true });
}

export async function writeBundle(options: {
  out: string;
  raw: string;
  config: StaticConfig & { build_id?: string };
  paywalls: PaywallResponse[];
  fetch?: Fetch;
  now?: () => Date;
}): Promise<BundleResult> {
  const fetchImpl = options.fetch ?? fetch;
  const files = new Map<string, Buffer>();
  const resourceCache = new Map<string, Promise<BundledFile>>();
  const failures: string[] = [];

  const store = (url: string, data: Buffer, mimeType: string): BundledFile => {
    const file = fileNameFor(url, data);
    files.set(file, data);
    return { url, file, mimeType };
  };

  const resource = (url: string): Promise<BundledFile> => {
    let pending = resourceCache.get(url);
    if (!pending) {
      pending = download(url, fetchImpl).then(({ data, mimeType }) => store(url, data, mimeType));
      resourceCache.set(url, pending);
    }
    return pending;
  };

  const bundled = await mapLimit(options.paywalls, 4, async (paywall): Promise<BundledPaywall | undefined> => {
    let document: { data: Buffer };
    try {
      document = await download(paywall.url, fetchImpl);
    } catch (error) {
      failures.push(`${paywall.identifier}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    const assets = findRemoteAssets(document.data.toString("utf8"));
    const resources = await mapLimit(assets, 8, async (url) => {
      try {
        return await resource(url);
      } catch (error) {
        failures.push(`${paywall.identifier}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    });
    const endpoints = (paywall.url_config?.endpoints ?? []).map((e) => e.url);
    return {
      identifier: paywall.identifier,
      urls: [...new Set([paywall.url, ...endpoints])],
      document: store(paywall.url, document.data, "text/html"),
      resources: resources.filter((r): r is BundledFile => r !== undefined),
    };
  });

  if (failures.length > 0) {
    throw new Error(`Could not download everything the bundle needs:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  }

  const manifest: BundleManifest = {
    version: BUNDLE_VERSION,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    ...(options.config.build_id ? { buildId: options.config.build_id } : {}),
    paywalls: bundled.filter((p): p is BundledPaywall => p !== undefined),
  };

  prepareOut(options.out);
  let bytes = Buffer.byteLength(options.raw);
  writeFileSync(join(options.out, BUNDLE_CONFIG), options.raw);
  for (const [file, data] of files) {
    writeFileSync(join(options.out, file), data);
    bytes += data.byteLength;
  }
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(options.out, BUNDLE_MANIFEST), manifestJson);
  bytes += Buffer.byteLength(manifestJson);

  return { out: options.out, manifest, bytes };
}
