import pc from "picocolors";
import { cmd, detailLines, exampleLines, renderPage, table, visible } from "@/ui/help-layout";
import type { AscResourceSpec } from "./define";
import type { AscFlag, AscOperation } from "./operation";

const USAGE_WIDTH = 32;

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function formatFlagUsage(key: string, flag: AscFlag): string {
  if (flag.type === "boolean") return `--${kebab(key)}`;
  return `--${kebab(key)} <${flag.value ?? "value"}>`;
}

function formatUsage(operation: AscOperation): string {
  const args = (operation.args ?? []).map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`));
  const flags = Object.entries(operation.flags ?? {})
    .filter(([, flag]) => flag.required)
    .map(([key, flag]) => formatFlagUsage(key, flag));
  return [...args, ...flags].join(" ");
}

function formatOperationRows(operations: readonly AscOperation[]): string[] {
  const rows = operations.map((operation): [string, string] => {
    const usage = formatUsage(operation);
    const shown = usage && usage.length <= USAGE_WIDTH ? ` ${pc.dim(usage)}` : "";
    return [`${cmd(operation.name)}${shown}`, operation.summary];
  });
  return table(rows, ([left]) => visible(left));
}

function renderOperationHelp(spec: AscResourceSpec, operation: AscOperation): string {
  const flags = Object.entries(operation.flags ?? {}).map(([key, flag]): [string, string] => {
    const choices = flag.choices ? ` (${flag.choices.join(", ")})` : "";
    return [cmd(formatFlagUsage(key, flag)), `${flag.required ? `${pc.yellow("required")} ` : ""}${flag.describe}${choices}`];
  });
  const common: [string, string][] = [
    [cmd("--app <app>"), "A Superwall app of the organization whose App Store Connect key to use"],
    [cmd("--team <id>"), "Apple team id, when your organization has several"],
  ];
  if (operation.effect !== "read") common.push([cmd("--dry-run"), "Print every request it would send; send no change"]);
  if (operation.effect === "destructive") common.push([cmd("-y, --yes"), "Go ahead without asking"]);
  common.push([cmd("--json"), "Machine-readable output"]);
  return renderPage({
    name: `${spec.name} ${operation.name}`,
    usage: `${formatUsage(operation)} [flags]`.trim(),
    summary: operation.summary,
    sections: [
      {
        title: "Arguments",
        rows: (operation.args ?? []).map((arg): [string, string] => [
          cmd(`<${arg.name}>`),
          `${arg.describe}${arg.choices ? ` (${arg.choices.join(", ")})` : ""}`,
        ]),
      },
      { title: "Flags", rows: flags },
      { title: "Common", rows: common },
      { title: "Details", lines: detailLines(operation.details) },
    ],
  });
}

export async function renderAscResourceHelp(spec: AscResourceSpec, words: readonly string[]): Promise<string> {
  const operation = spec.operations.find((candidate) => candidate.name === words[0]);
  if (operation) return renderOperationHelp(spec, operation);
  return renderPage({
    name: spec.name,
    usage: "<operation> [flags]",
    summary: spec.summary,
    sections: [
      { title: "Operations", lines: formatOperationRows(spec.operations) },
      { title: "Details", lines: detailLines(spec.details) },
      { title: "Examples", lines: exampleLines(spec.examples) },
    ],
    footer: `Run ${pc.bold(`superwall ${spec.name} <operation> --help`)} for an operation's flags.`,
  });
}
