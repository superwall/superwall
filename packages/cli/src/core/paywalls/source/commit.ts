export interface SurfaceCommitInput {
  kind: "paywall" | "funnel";
  surface: string;
  version: number;
  paywallId: string;
  applicationId: string;
  snapshotSha?: string;
  framework: string;
  cli?: string;
  note?: string;
  external?: readonly string[];
}

export interface WorkspaceCommitInput {
  kind: "workspace";
  surface: string;
  workspaceId: string;
  sdk?: string;
  cli?: string;
  note?: string;
}

export type CommitMessageInput = SurfaceCommitInput | WorkspaceCommitInput;

const workspaceCommitMessage = (input: WorkspaceCommitInput): string => {
  const surface = `workspace/${input.surface}`;
  const trailers = [`Superwall-Workspace: ${input.workspaceId}`, `Superwall-Surface: ${surface}`];
  if (input.sdk) trailers.push(`Superwall-Workspace-Sdk: ${input.sdk}`);
  if (input.cli) trailers.push(`Superwall-Cli: ${input.cli}`);
  const note = input.note?.replace(/\r\n?/g, "\n").trim();
  return `push ${surface}\n${note ? `\n${note}\n` : ""}\n${trailers.join("\n")}\n`;
};

export const buildCommitMessage = (input: CommitMessageInput): string => {
  if (input.kind === "workspace") return workspaceCommitMessage(input);
  const surface = `${input.kind}/${input.surface}`;
  const subject = `publish ${surface} v${input.version}`;

  const external = (input.external ?? []).filter((entry) => entry.trim() !== "");

  const trailers = [
    `Superwall-Paywall: ${input.paywallId}`,
    `Superwall-Application: ${input.applicationId}`,
    `Superwall-Version: ${input.version}`,
    `Superwall-Surface: ${surface}`,
    `Superwall-Portable: ${external.length === 0}`,
  ];
  if (external.length > 0) trailers.push(`Superwall-External: ${external.join(", ")}`);
  if (input.snapshotSha) trailers.push(`Superwall-Snapshot: ${input.snapshotSha}`);
  trailers.push(`Superwall-Framework: ${input.framework}`);
  if (input.cli) trailers.push(`Superwall-Cli: ${input.cli}`);

  const note = input.note?.replace(/\r\n?/g, "\n").trim();
  const body = note ? `\n${note}\n` : "";
  return `${subject}\n${body}\n${trailers.join("\n")}\n`;
};

export const tokenSecret = (token: string): string => token.split("?")[0] ?? token;

export const redact = (text: string, ...secrets: string[]): string => {
  let safe = text;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    safe = safe.split(secret).join("***");
  }
  return safe;
};
