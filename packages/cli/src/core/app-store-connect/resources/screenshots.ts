import { isRecord } from "@/core/json";
import { attribute, linkTo, type AscResource } from "./json-api";
import { argOf, type AscInput, type AscOutput } from "./operation";
import type { PricedKind } from "./pricing";
import { statusOf, type AscSession, type UploadOperation } from "./session";
import { resolveTarget } from "./targets";

const PRICED: readonly PricedKind[] = ["subscription", "iap"];
const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 60;
const COMMIT_ATTEMPTS = 3;
const COMMIT_PAUSE_MS = 2000;

const SCREENSHOT = {
  subscription: {
    of: (id: string) => `/v1/subscriptions/${id}/appStoreReviewScreenshot`,
    path: "/v1/subscriptionAppStoreReviewScreenshots",
    type: "subscriptionAppStoreReviewScreenshots",
    owner: "subscription",
    ownerType: "subscriptions",
    label: "subscription",
  },
  iap: {
    of: (id: string) => `/v2/inAppPurchases/${id}/appStoreReviewScreenshot`,
    path: "/v1/inAppPurchaseAppStoreReviewScreenshots",
    type: "inAppPurchaseAppStoreReviewScreenshots",
    owner: "inAppPurchaseV2",
    ownerType: "inAppPurchases",
    label: "in-app purchase",
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

function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

type Reservation = { state: string | undefined } | "gone" | "unknown";

async function readReservation(session: AscSession, path: string): Promise<Reservation> {
  try {
    const resource = await session.select(path);
    return resource ? { state: deliveryState(resource) } : "gone";
  } catch {
    return "unknown";
  }
}

function accepted(reservation: Reservation): boolean {
  return typeof reservation === "object" && reservation.state !== undefined && reservation.state !== "AWAITING_UPLOAD";
}

interface FailedCommit {
  failure: Error;
  reservation: Reservation;
  attempts: number;
}

async function commitUpload(session: AscSession, path: string, body: unknown): Promise<FailedCommit | undefined> {
  for (let attempt = 1; ; attempt++) {
    try {
      await session.send("patch", path, body);
      return undefined;
    } catch (error) {
      const status = statusOf(error);
      if (status === undefined || status < 500) throw error;
      const reservation = await readReservation(session, path);
      if (accepted(reservation)) return undefined;
      if (reservation === "gone" || attempt >= COMMIT_ATTEMPTS) return { failure: error as Error, reservation, attempts: attempt };
      await pause(COMMIT_PAUSE_MS * attempt);
    }
  }
}

async function failedCommitMessage(
  session: AscSession,
  path: string,
  failure: FailedCommit,
  label: string,
  replaced: string | undefined,
): Promise<string> {
  const id = path.slice(path.lastIndexOf("/") + 1);
  const lines = [
    `Apple failed to commit the screenshot after its bytes were uploaded (${failure.attempts === 1 ? "1 attempt" : `${failure.attempts} attempts`}):`,
    ...failure.failure.message.split("\n").filter((line) => !line.startsWith("Already created:")),
  ];
  if (failure.reservation === "gone") {
    lines.push(`Apple no longer has the unfinished screenshot ${id}.`);
  } else if (failure.reservation === "unknown") {
    lines.push(`Couldn't read the unfinished screenshot ${id} to check its state, so it was left in place; it may stay in AWAITING_UPLOAD.`);
  } else {
    try {
      await session.send("delete", path);
      lines.push(`Deleted the unfinished screenshot ${id} so it doesn't stay in AWAITING_UPLOAD.`);
    } catch (error) {
      lines.push(`Couldn't delete the unfinished screenshot ${id}, so it stays in AWAITING_UPLOAD: ${(error as Error).message}`);
    }
  }
  if (replaced) lines.push(`The earlier screenshot ${replaced} was deleted before the upload, so this ${label} has no review screenshot now.`);
  lines.push("This is an error on Apple's side. Try the upload again later.");
  return lines.join("\n");
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
  const failed = await commitUpload(session, `${spec.path}/${reserved.id}`, {
    data: { type: spec.type, id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: file.checksum } },
  });
  if (failed) throw new Error(await failedCommitMessage(session, `${spec.path}/${reserved.id}`, failed, spec.label, existing?.id));
  const state = await resolveDeliveryState(session, `${spec.path}/${reserved.id}`);
  return {
    value: { id: reserved.id, fileName: file.name, fileSize: file.bytes.length, state, ...(existing ? { replaced: existing.id } : {}) },
    heading: state === "COMPLETE" ? `Uploaded ${file.name}` : `Uploaded ${file.name}; Apple is still processing it`,
  };
}
