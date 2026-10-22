import { UsageError, type CommandContext } from "@/program/command";
import { renderValue } from "@/core/main/views";
import { attribute, linkTo } from "./json-api";
import { plural } from "./operation";
import { printAscPlan } from "./print";
import { createAscSession, type AscSession } from "./session";
import { selectLatestVersion, KINDS, resolveAscAppId, type ProductKind } from "./targets";

interface SubmitInput {
  ascApp: string | undefined;
  subscription: string[];
  group: string[];
  iap: string[];
  team: string | undefined;
}

export interface SubmissionItem {
  relationship: string;
  type: string;
  id: string;
}

interface SubmissionView {
  id: string;
  state?: string;
  reused: boolean;
}

export async function createReviewSubmission(session: AscSession, app: string, platform: string, items: readonly SubmissionItem[]): Promise<SubmissionView> {
  const open = await session.get(`/v1/reviewSubmissions?filter[app]=${app}&filter[state]=READY_FOR_REVIEW&filter[platform]=${platform}&limit=1`);
  const reused = open?.data[0];
  const submission =
    reused ??
    (await session.send(
      "post",
      "/v1/reviewSubmissions",
      { data: { type: "reviewSubmissions", attributes: { platform }, relationships: { app: linkTo("apps", app) } } },
      "submission",
    ));
  if (!submission) throw new Error("Apple opened no review submission.");
  for (const item of items) {
    await session.send(
      "post",
      "/v1/reviewSubmissionItems",
      { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: linkTo("reviewSubmissions", submission.id), [item.relationship]: linkTo(item.type, item.id) } } },
      "item",
    );
  }
  const submitted = await session.send("patch", `/v1/reviewSubmissions/${submission.id}`, {
    data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } },
  });
  const state = submitted ? attribute(submitted, "state") : undefined;
  return { id: submission.id, ...(state ? { state } : {}), reused: reused !== undefined };
}

export async function runAscSubmit(ctx: CommandContext<"required">, input: SubmitInput): Promise<void> {
  const wanted: { kind: ProductKind; id: string }[] = [
    ...input.group.map((id) => ({ kind: "group" as const, id })),
    ...input.subscription.map((id) => ({ kind: "subscription" as const, id })),
    ...input.iap.map((id) => ({ kind: "iap" as const, id })),
  ];
  if (!input.ascApp) throw new UsageError("Pass --asc-app <id|bundle id>: the App Store app to submit for.");
  if (wanted.length === 0) throw new UsageError("Say what to submit: --subscription, --group or --iap <id>, each as often as needed.");
  const session = await createAscSession(ctx, input.team);
  const app = await resolveAscAppId(session, input.ascApp);
  const items = [];
  for (const { kind, id } of wanted) {
    const version = await selectLatestVersion(session, kind, id);
    if (!version) throw new Error(`The ${KINDS[kind].noun} ${id} has no version to submit.`);
    items.push({ kind, id, version });
  }

  const submission = await createReviewSubmission(
    session,
    app,
    "IOS",
    items.map(({ kind, version }) => ({ relationship: KINDS[kind].submitItem, type: KINDS[kind].versionType, id: version.id })),
  );
  if (session.dryRun) return printAscPlan(ctx, session.planned);
  renderValue(
    ctx,
    { reviewSubmission: submission, items },
    `Submitted ${plural(items.length, "item")} for review`,
  );
}
