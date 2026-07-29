import * as fs from "node:fs";
import { ASSET_HOST } from "@/constants";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import {
  pushPaywallAssets,
  type AssetManifestEntry,
  type VersionAsset,
} from "@/core/api/resources";
import type { BuiltSnapshot } from "./project/framework";

export const assetBaseUrl = (applicationId: string): string => `${ASSET_HOST}/${applicationId}`;

export interface BuildAsset {
  fileName: string;
  sha256: string;
  bytes: number;
  mime: string;
  path: string;
}

export function requireAssets(built: BuiltSnapshot): BuildAsset[] {
  if (!Array.isArray(built.assets)) {
    throw new AssetSyncError(
      "This project's superwall version builds snapshots without hosted assets — " +
        "update the project's superwall dependency to push.",
    );
  }
  return built.assets;
}

export interface SyncedAssets {
  assets: VersionAsset[];
  uploaded: number;
  uploadedBytes: number;
  totalBytes: number;
}

export class AssetSyncError extends Error {}

export const assetName = (asset: BuildAsset): string =>
  asset.path.split(/[\\/]/).pop() || asset.fileName;

export function uploadFailure(
  asset: BuildAsset,
  response: { status: number } | undefined,
): AssetSyncError {
  const name = assetName(asset);
  if (!response) {
    return new AssetSyncError(
      `Couldn't upload ${name} — the asset store is unreachable. Check your network, then push again.`,
    );
  }
  if (response.status === 404 || response.status === 403) {
    return new AssetSyncError(
      `Couldn't upload ${name} — the asset store rejected the upload with HTTP ${response.status}. ` +
        "That upload URL is issued by Superwall and expires, so this usually means the storage " +
        "endpoint is misconfigured or unreachable rather than anything wrong with the file.",
    );
  }
  return new AssetSyncError(`Couldn't upload ${name} — the asset store returned HTTP ${response.status}.`);
}

const CACHE_CONTROL = "public, max-age=31536000, immutable";
const UPLOAD_CONCURRENCY = 4;

const pool = async <T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> => {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await work(item);
    }
  });
  await Promise.all(runners);
};

export async function syncAssets(input: {
  api: SuperwallApi;
  paywallId: string;
  assets: readonly BuildAsset[];
  put?: typeof fetch;
  read?: (path: string) => Buffer;
}): Promise<SyncedAssets> {
  const { api, paywallId, assets } = input;
  const put = input.put ?? fetch;
  const read = input.read ?? ((path: string) => fs.readFileSync(path));

  const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  if (assets.length === 0) {
    return { assets: [], uploaded: 0, uploadedBytes: 0, totalBytes: 0 };
  }

  const manifest: AssetManifestEntry[] = assets.map((asset) => ({
    sha256: asset.sha256,
    bytes: asset.bytes,
    mime: asset.mime,
    file_name: asset.fileName,
  }));

  const resolved = await pushPaywallAssets(api, paywallId, manifest).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) {
      throw new AssetSyncError(
        "This Superwall environment does not support hosted assets yet. " +
          "Keep every asset under 32 kB so the snapshot can inline it, or upgrade the platform.",
      );
    }
    throw error;
  });
  const bySha = new Map(resolved.map((entry) => [entry.sha256, entry]));

  const missing: BuildAsset[] = [];
  const hosted = new Map<string, string>();

  for (const asset of assets) {
    const entry = bySha.get(asset.sha256);
    if (!entry) {
      throw new AssetSyncError(
        `Superwall did not return a URL for ${assetName(asset)} — asset sync is incomplete.`,
      );
    }
    if (!entry.url.endsWith(`/${asset.fileName}`)) {
      throw new AssetSyncError(
        `Superwall hosted ${asset.fileName} at ${entry.url}, which does not match the URL ` +
          "baked into the snapshot. Delete superwall.lock and push again to rebind this paywall.",
      );
    }
    hosted.set(asset.sha256, entry.url);
    if (entry.uploadUrl !== undefined) missing.push(asset);
  }

  let uploadedBytes = 0;

  await pool(missing, UPLOAD_CONCURRENCY, async (asset) => {
    const uploadUrl = bySha.get(asset.sha256)?.uploadUrl;
    if (uploadUrl === undefined) return;
    const body = read(asset.path);

    const send = () =>
      put(uploadUrl, {
        method: "PUT",
        headers: { "content-type": asset.mime, "cache-control": CACHE_CONTROL },
        body: new Uint8Array(body),
      });

    let response = await send().catch(() => undefined);
    if (!response?.ok) response = await send().catch(() => undefined);
    if (!response?.ok) throw uploadFailure(asset, response);
    uploadedBytes += asset.bytes;
  });

  return {
    assets: assets.map((asset) => ({
      url: hosted.get(asset.sha256) ?? "",
      mime_type: asset.mime,
    })),
    uploaded: missing.length,
    uploadedBytes,
    totalBytes,
  };
}
