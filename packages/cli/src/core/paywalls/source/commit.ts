interface PublishCommitInput {
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

interface ProjectCommitInput {
  kind: "project";
  applicationId: string;
  framework: string;
  cli?: string;
  note?: string;
}

export type CommitMessageInput = PublishCommitInput | ProjectCommitInput;

const noteBody = (note: string | undefined): string => {
  const text = note?.replace(/\r\n?/g, "\n").trim();
  return text ? `\n${text}\n` : "";
};

export const buildCommitMessage = (input: CommitMessageInput): string => {
  if (input.kind === "project") {
    const trailers = [`Superwall-Application: ${input.applicationId}`, `Superwall-Framework: ${input.framework}`];
    if (input.cli) trailers.push(`Superwall-Cli: ${input.cli}`);
    return `publish project source\n${noteBody(input.note)}\n${trailers.join("\n")}\n`;
  }
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

  return `${subject}\n${noteBody(input.note)}\n${trailers.join("\n")}\n`;
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
