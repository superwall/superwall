import { isRecord } from "@/core/json";
import { attribute, linkTo, type AscResource } from "./json-api";
import { argOf, type AscInput, type AscOutput } from "./operation";
import type { PricedKind } from "./pricing";
import type { AscSession, UploadOperation } from "./session";
import { resolveTarget } from "./targets";

const PRICED: readonly PricedKind[] = ["subscription", "iap"];
const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 60;

const SCREENSHOT = {
  subscription: {
    of: (id: string) => `/v1/subscriptions/${id}/appStoreReviewScreenshot`,
    path: "/v1/subscriptionAppStoreReviewScreenshots",
    type: "subscriptionAppStoreReviewScreenshots",
    owner: "subscription",
    ownerType: "subscriptions",
  },
  iap: {
    of: (id: string) => `/v2/inAppPurchases/${id}/appStoreReviewScreenshot`,
    path: "/v1/inAppPurchaseAppStoreReviewScreenshots",
    type: "inAppPurchaseAppStoreReviewScreenshots",
    owner: "inAppPurchaseV2",
    ownerType: "inAppPurchases",
  },
} as const;

export interface ScreenshotView {
  id: string;
  fileName?: string;
  state?: string;
}

function deliveryState(resource: AscResource): string | undefined {
  const state = resource.attributes.assetDeliveryState;
  return isRecord(state) && typeof state.state === "string" ? state.state : undefined;
}

export async function selectScreenshot(session: AscSession, kind: PricedKind, id: string): Promise<ScreenshotView | undefined> {
  const found = await session.select(SCREENSHOT[kind].of(id));
  if (!found) return undefined;
  const fileName = attribute(found, "fileName");
  const state = deliveryState(found);
  return { id: found.id, ...(fileName ? { fileName } : {}), ...(state ? { state } : {}) };
}

function uploadOperationsOf(resource: AscResource): UploadOperation[] {
  const operations = resource.attributes.uploadOperations;
  if (!Array.isArray(operations)) return [];
  return operations.filter(isRecord).map((operation) => ({
    method: typeof operation.method === "string" ? operation.method : "PUT",
    url: String(operation.url),
    offset: Number(operation.offset ?? 0),
    length: Number(operation.length ?? 0),
    headers: Object.fromEntries(
      (Array.isArray(operation.requestHeaders) ? operation.requestHeaders : [])
        .filter(isRecord)
        .map((header) => [String(header.name), String(header.value)]),
    ),
  }));
}

async function resolveDeliveryState(session: AscSession, path: string): Promise<string> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const document = await session.get(path);
    const resource = document?.one;
    const state = resource ? deliveryState(resource) : undefined;
    if (!resource || state === "COMPLETE") return state ?? "COMPLETE";
    if (state === "FAILED") {
      const errors = resource.attributes.assetDeliveryState;
      throw new Error(`Apple couldn't process the screenshot: ${JSON.stringify(isRecord(errors) ? errors.errors : errors)}`);
    }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
  }
  return "PROCESSING";
}

export async function runScreenshotsUpload(session: AscSession, input: AscInput): Promise<AscOutput> {
  const { kind, id } = resolveTarget(input, PRICED);
  const spec = SCREENSHOT[kind];
  const { readScreenshotFile } = await import("./screenshot-file");
  const file = readScreenshotFile(argOf(input, "file"));
  const existing = await selectScreenshot(session, kind, id);
  if (existing) await session.send("delete", `${spec.path}/${existing.id}`);
  const reserved = await session.send(
    "post",
    spec.path,
    {
      data: {
        type: spec.type,
        attributes: { fileName: file.name, fileSize: file.bytes.length },
        relationships: { [spec.owner]: linkTo(spec.ownerType, id) },
      },
    },
    "screenshot",
  );
  if (!reserved) throw new Error("Apple reserved no upload for the screenshot.");
  await session.upload(uploadOperationsOf(reserved), file.bytes);
  await session.send("patch", `${spec.path}/${reserved.id}`, {
    data: { type: spec.type, id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: file.checksum } },
  });
  const state = await resolveDeliveryState(session, `${spec.path}/${reserved.id}`);
  return {
    value: { id: reserved.id, fileName: file.name, fileSize: file.bytes.length, state, ...(existing ? { replaced: existing.id } : {}) },
    heading: state === "COMPLETE" ? `Uploaded ${file.name}` : `Uploaded ${file.name}; Apple is still processing it`,
  };
}
