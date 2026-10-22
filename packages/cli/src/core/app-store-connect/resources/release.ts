import { attribute, compact, linkTo, relatedId, type AscResource } from "./json-api";
import { argOf, listOf, type AscInput, type AscOutput } from "./operation";
import { assertConfirmed, type AscSession } from "./session";
import { createReviewSubmission, type SubmissionItem } from "./submit";
import { KINDS, selectLatestVersion, type ProductKind } from "./targets";
import {
  buildOf,
  findVersion,
  phasedReleaseOf,
  resolveVersionId,
  rowOfVersion,
  viewOfPhasedRelease,
  type VersionRow,
} from "./versions";

export const PHASED_ACTIONS = ["start", "pause", "resume", "complete"] as const;
const TRANSITIONS: Record<Exclude<(typeof PHASED_ACTIONS)[number], "start">, { from: readonly string[]; to: string }> = {
  pause: { from: ["ACTIVE"], to: "PAUSED" },
  resume: { from: ["PAUSED"], to: "ACTIVE" },
  complete: { from: ["ACTIVE", "PAUSED"], to: "COMPLETE" },
};

function appOf(version: AscResource): string {
  const app = relatedId(version, "app");
  if (!app) throw new Error(`Apple named no app for version ${version.id}.`);
  return app;
}

const nameOf = (row: VersionRow) => row.versionString ?? row.id;

export async function runReleaseSubmit(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = await resolveVersionId(session, input);
  const { version, document } = await findVersion(session, id, ["app", "build"]);
  const row = rowOfVersion(version);
  if (!buildOf(document, version)) {
    throw new Error(`Version ${nameOf(row)} has no build. Attach one first: asc builds attach <build> ${id}.`);
  }
  const products: { kind: ProductKind; id: string }[] = [
    ...listOf(input, "group").map((product) => ({ kind: "group" as const, id: product })),
    ...listOf(input, "subscription").map((product) => ({ kind: "subscription" as const, id: product })),
    ...listOf(input, "iap").map((product) => ({ kind: "iap" as const, id: product })),
  ];
  const items: SubmissionItem[] = [{ relationship: "appStoreVersion", type: "appStoreVersions", id }];
  for (const product of products) {
    const latest = await selectLatestVersion(session, product.kind, product.id);
    if (!latest) throw new Error(`The ${KINDS[product.kind].noun} ${product.id} has no version to submit.`);
    items.push({ relationship: KINDS[product.kind].submitItem, type: KINDS[product.kind].versionType, id: latest.id });
  }
  const submission = await createReviewSubmission(session, appOf(version), row.platform ?? "IOS", items);
  const extra = products.length ? ` with ${products.length} in-app product${products.length === 1 ? "" : "s"}` : "";
  return { value: { reviewSubmission: submission, appStoreVersion: row, items }, heading: `Submitted version ${nameOf(row)}${extra} for review` };
}

export async function runReleaseRelease(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = await resolveVersionId(session, input);
  const row = rowOfVersion((await findVersion(session, id)).version);
  if (row.appVersionState !== "PENDING_DEVELOPER_RELEASE") {
    throw new Error(`Version ${nameOf(row)} is ${row.appVersionState ?? "in an unknown state"}; only a version pending developer release (PENDING_DEVELOPER_RELEASE) can be released.`);
  }
  await assertConfirmed(session, input.yes, `Release version ${nameOf(row)} to the App Store`);
  await session.send(
    "post",
    "/v1/appStoreVersionReleaseRequests",
    { data: { type: "appStoreVersionReleaseRequests", relationships: { appStoreVersion: linkTo("appStoreVersions", id) } } },
    "releaseRequest",
  );
  return { value: { ...row, released: true }, heading: `Released version ${nameOf(row)}` };
}

export async function runReleasePhased(session: AscSession, input: AscInput): Promise<AscOutput> {
  const action = PHASED_ACTIONS.find((candidate) => candidate === argOf(input, "action"));
  if (!action) throw new Error(`asc release phased takes ${PHASED_ACTIONS.join(", ")}.`);
  const id = await resolveVersionId(session, input);
  const name = argOf(input, "version");
  const current = await session.select(`/v1/appStoreVersions/${id}/appStoreVersionPhasedRelease`);
  const state = current ? attribute(current, "phasedReleaseState") : undefined;
  if (action === "start") {
    if (current) throw new Error(`Version ${name} already has a phased release (${state ?? "state unknown"}).`);
    const created = await session.send(
      "post",
      "/v1/appStoreVersionPhasedReleases",
      { data: { type: "appStoreVersionPhasedReleases", relationships: { appStoreVersion: linkTo("appStoreVersions", id) } } },
      "phasedRelease",
    );
    if (!created) throw new Error("Apple created no phased release.");
    return { value: { appStoreVersion: id, phasedRelease: viewOfPhasedRelease(created) }, heading: `Phased release on for version ${name}` };
  }
  if (!current) throw new Error(`Version ${name} has no phased release. Turn it on with asc release phased start ${name}.`);
  const { from, to } = TRANSITIONS[action];
  if (!from.includes(state ?? "")) throw new Error(`The phased release of version ${name} is ${state ?? "in an unknown state"}; ${action} needs ${from.join(" or ")}.`);
  await session.send("patch", `/v1/appStoreVersionPhasedReleases/${current.id}`, {
    data: { type: "appStoreVersionPhasedReleases", id: current.id, attributes: { phasedReleaseState: to } },
  });
  return { value: { appStoreVersion: id, phasedRelease: { ...viewOfPhasedRelease(current), phasedReleaseState: to } }, heading: `Phased release of version ${name}: ${to}` };
}

export async function runReleaseStatus(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = await resolveVersionId(session, input);
  const { version, document } = await findVersion(session, id, ["app", "build", "appStoreVersionPhasedRelease"]);
  const row = rowOfVersion(version);
  const submissions = await session.next(
    `/v1/reviewSubmissions?filter[app]=${appOf(version)}&filter[platform]=${row.platform ?? "IOS"}&include=appStoreVersionForReview&fields[reviewSubmissions]=platform,state,submittedDate,appStoreVersionForReview&fields[appStoreVersions]=versionString&limit=50`,
  );
  const submission = submissions.data.find((candidate) => relatedId(candidate, "appStoreVersionForReview") === id);
  return {
    value: {
      ...row,
      build: buildOf(document, version),
      reviewSubmission: submission ? { id: submission.id, ...compact({ state: attribute(submission, "state"), submittedDate: attribute(submission, "submittedDate") }) } : null,
      phasedRelease: phasedReleaseOf(document, version),
    },
    heading: `Version ${nameOf(row)}: ${row.appVersionState ?? "state unknown"}`,
  };
}
