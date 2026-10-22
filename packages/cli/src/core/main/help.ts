import pc from "picocolors";
import type { DocField } from "@/core/api/reference";
import { cmd, detailLines, exampleLines, renderPage, table, visible } from "@/ui/help-layout";
import {
  argLabel,
  findNested,
  findSpec,
  findOperation,
  positionalParams,
  SCOPE_PARAMS,
  scopeParams,
  usageOf,
  type Operation,
  type Resource,
} from "./catalog";

function formatOperationRows(owner: Resource, ops: Operation[]): string[] {
  const rows = ops.map((op): [string, string] => {
    const usage = usageOf(owner, op);
    return [`${cmd(op.name)}${usage ? ` ${pc.dim(usage)}` : ""}`, op.summary];
  });
  return table(rows, ([left]) => visible(left));
}

function footer(name: string): string {
  return `Run ${pc.bold(`superwall ${name} <operation> --help`)} for an operation's flags.`;
}

export function nestedHelp(owner: Resource, nested: Resource): string {
  const name = `${owner.name} ${nested.name}`;
  return renderPage({
    name,
    usage: "<operation>",
    summary: nested.summary,
    sections: [{ title: "Operations", lines: formatOperationRows(owner, nested.operations) }],
    footer: footer(name),
  });
}

export function resourceHelp(resource: Resource): string {
  return renderPage({
    name: resource.name,
    usage: `<operation> ${resource.appArg ? "<app>" : "[ids]"} [flags]`,
    summary: resource.summary,
    sections: [
      {
        title: "Arguments",
        rows: resource.appArg ? [[cmd("<app>"), "The app: an id, a name or a dashboard link"]] : [],
      },
      { title: "Operations", lines: formatOperationRows(resource, resource.operations) },
      ...(resource.nested ?? []).map((nested) => ({
        title: `${resource.name} ${nested.name}`,
        lines: formatOperationRows(resource, nested.operations),
      })),
      {
        title: "Related",
        lines: table(
          (resource.related ?? []).map(([command, text]): [string, string] => [`superwall ${command}`, pc.dim(text)]),
          ([left]) => left.length,
        ),
      },
      { title: "Examples", lines: exampleLines(resource.examples ?? []) },
    ],
    footer: footer(resource.name),
  });
}

function formatFieldRows(fields: (DocField & { in?: string })[]): [string, string][] {
  return fields.map((field) => {
    const flag = `--${field.name.replace(/_/g, "-")}`;
    const bare = field.type.replace(/\s*\|\s*null\b/g, "").trim();
    const type = bare === "boolean" ? "" : ` ${pc.dim(`<${bare.length > 24 ? `${bare.slice(0, 23)}…` : bare}>`)}`;
    const required = field.required ? `${pc.yellow("required")} ` : "";
    return [`${cmd(flag)}${type}`, `${required}${field.description ?? ""}`];
  });
}

async function operationHelp(owner: Resource, resource: Resource, op: Operation): Promise<string> {
  const name = owner === resource ? `${owner.name} ${op.name}` : `${owner.name} ${resource.name} ${op.name}`;
  const usage = usageOf(owner, op);
  let note: string | undefined;
  const flagRows: [string, string][] = [];
  if (!op.path) {
    flagRows.push(...(op.flags ?? []).map(([flag, text]): [string, string] => [cmd(flag), text]));
  } else {
    const spec = await findSpec(op);
    note = spec ? spec.description : "Flags come from the API reference, which couldn't be loaded.";
    const typed = new Set(positionalParams(op));
    const params = (spec?.params ?? []).filter(
      (param) =>
        param.in === "query" &&
        !["starting_after", "ending_before", "iterator"].includes(param.name) &&
        !typed.has(param.name) &&
        !SCOPE_PARAMS[param.name],
    );
    const body = (spec?.body ?? []).filter((field) => !SCOPE_PARAMS[field.name]);
    flagRows.push(...formatFieldRows(params), ...formatFieldRows(body));
    flagRows.push(...(op.flags ?? []).map(([flag, text]): [string, string] => [cmd(flag), text]));
  }

  const args = op.usage === undefined ? positionalParams(op) : [];
  const argRows: [string, string][] =
    owner.appArg && op.usage === undefined
      ? [[cmd("<app>"), "The app: an id, a name or a dashboard link"]]
      : args.map((param): [string, string] => {
          const label = argLabel(param === "id" ? owner : resource, param);
          return [cmd(label), `The ${label.slice(1, -1).replace(/-/g, " ")}'s ${param === "app_user_id" ? "app user ID" : "id"}`];
        });

  const common: [string, string][] = [];
  const needsApp = !owner.appArg && (op.handler ? op.name !== "get" : scopeParams(op).size > 0 || op.list);
  if (needsApp) common.push([cmd("--app <app>"), "The app it's about (id, name or link); asked when left out"]);
  if (op.path && op.method !== "GET") common.push([cmd("-d key=value"), "Any other field, Stripe-style; key:=json for numbers and objects"]);
  if (op.path && op.method !== "GET") common.push([cmd("--dry-run"), "Print the request; send nothing"]);
  if (op.destructive) common.push([cmd("-y, --yes"), "Go ahead without asking"]);
  if (op.list && !op.handler) {
    common.push([cmd("--search <text>"), "Only rows whose id, name or identifier contains this"]);
    common.push([cmd("--limit <n>"), "At most this many rows"]);
  }
  common.push([cmd("--json"), "The API's response, unformatted"]);

  return renderPage({
    name,
    usage: `${usage ? `${usage} ` : ""}[flags]`,
    summary: op.summary,
    note,
    sections: [
      { title: "Arguments", rows: argRows },
      { title: "Flags", rows: flagRows },
      { title: "Common", rows: common },
      { title: "Details", lines: detailLines(op.details) },
    ],
  });
}

export async function renderResourceHelp(owner: Resource, words: readonly string[]): Promise<string> {
  const nested = words[0] ? findNested(owner, words[0]) : undefined;
  const resource = nested ?? owner;
  const opName = nested ? words[1] : words[0];
  const op = opName ? findOperation(resource, opName) : undefined;
  if (op) return operationHelp(owner, resource, op);
  if (nested) return nestedHelp(owner, nested);
  return resourceHelp(owner);
}
