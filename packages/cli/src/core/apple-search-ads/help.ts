import pc from "picocolors";
import { cmd, detailLines, exampleLines, renderPage, table, visible } from "@/ui/help-layout";
import { asaActions, asaGroups, asaVariants, placeholdersOf, type AsaOperation } from "./catalog";

interface Entry {
  path: string;
  usage: string;
  summary: string;
  parent?: boolean;
  section?: string;
}

interface AsaPage {
  path: string;
  listing?: string;
  usage: string;
  summary: string;
  children?: Entry[];
  flags?: [string, string][];
  details?: string;
  examples?: [string, string][];
}

function renderAsaPage(page: AsaPage): string {
  const children = (page.children ?? []).map((child): [string, string] => {
    const name = child.path.slice(page.path.length + 1);
    const usage = child.parent || child.usage.length > 32 ? "" : ` ${pc.dim(child.usage)}`;
    return [`${cmd(name)}${usage}`, child.summary];
  });
  const leaf = children.length === 0;
  const lines = table(children, ([left]) => visible(left));
  const titles = [...new Set((page.children ?? []).map((child) => child.section ?? page.listing ?? "Commands"))];
  const listing = titles.map((title) => ({
    title,
    lines: lines.filter((_, index) => (page.children?.[index]?.section ?? page.listing ?? "Commands") === title),
  }));
  return renderPage({
    name: page.path,
    usage: page.usage,
    summary: page.summary,
    sections: [
      ...listing,
      { title: "Flags", rows: page.flags ?? [] },
      {
        title: "Common",
        rows: leaf
          ? [
              [cmd("--json"), "Machine-readable output"],
              [cmd("--no-interactive"), "No prompts, for scripts and CI"],
            ]
          : [],
      },
      { title: "Details", lines: detailLines(page.details) },
      { title: "Examples", lines: exampleLines(page.examples ?? []) },
    ],
    footer: leaf ? undefined : `Run ${pc.bold(`superwall ${page.path} <${page.listing === "Operations" ? "operation" : "command"}> --help`)} for its flags.`,
  });
}

function formatAsaUsage(op: AsaOperation): string {
  const parts: string[] = [];
  if (op.positional === "id") parts.push("<id>");
  if (op.positional === "ids") parts.push("<id[,id…]>");
  if (op.positional === "query") parts.push("<query>");
  if (op.positional === "adam-id") parts.push("<adam-id>");
  for (const placeholder of placeholdersOf(op.path)) {
    if (placeholder === "campaign") parts.push("--campaign <id>");
    if (placeholder === "adgroup") parts.push("--adgroup <id>");
    if (placeholder === "adamId" && op.positional !== "adam-id") parts.push("--adam-id <id>");
  }
  return parts.join(" ");
}

function formatAsaFlags(op: AsaOperation, variants: AsaOperation[]): [string, string][] {
  const rows: [string, string][] = (op.flags ?? []).map((flag) => {
    const value = { boolean: "", money: " <amount>", list: " <a,b,c>", number: " <n>", string: " <value>" }[flag.type];
    return [`${cmd(`--${flag.flag}`)}${pc.dim(value)}`, flag.describe];
  });
  const add = (flag: string, text: string) => rows.push([cmd(flag), text]);
  if (op.body === "object" || op.body === "array") {
    add("-d key=value", "Another body field; key:=json for numbers and objects");
    add("--body <json|@file|@->", "The whole request body");
  }
  if (op.body === "selector" || op.body === "report") add("--selector <json|@file|@->", "An Apple selector");
  if (op.body === "selector") {
    add("--field --op --values", "One condition, e.g. --field status --op EQUALS --values ENABLED");
    add("--order-by <field[:asc|desc]>", "Sort");
  }
  if (op.body === "report") add("--time-zone <UTC|ORTZ>", "Report time zone (default UTC)");
  if (op.body === "selector" || op.query?.includes("fields")) add("--fields <a,b>", "Only these fields");
  if (op.paged) add("--limit <n> --offset <n> --all", "Paging; --all walks every page");
  if (variants.some((variant) => variant.level === "adgroup")) add("--adgroup-level", "Ad group negatives instead of the campaign's");
  rows.push([cmd("--app <app>"), "The Superwall app whose Apple Search Ads account to use"]);
  return rows;
}

export function renderAsaHelp(words: readonly string[]): string {
  const groups = asaGroups();
  const [group, action] = words;
  if (!group || !groups.includes(group)) {
    return renderAsaPage({
      path: "asa",
      usage: "<resource> <operation>",
      summary: "The Apple Search Ads API through Superwall's proxy: no key or token handling",
      children: [
        ...groups.map((name) => ({
          path: `asa ${name}`,
          usage: "",
          summary: asaActions(name).join(" · "),
          parent: true,
          section: "Resources",
        })),
        { path: "asa keys", usage: "", summary: "Which apps have Apple Search Ads connected", section: "Keys" },
        { path: "asa get", usage: "<path>", summary: "Any GET request", section: "Any request" },
        { path: "asa post", usage: "<path>", summary: "Any POST request", section: "Any request" },
        { path: "asa put", usage: "<path>", summary: "Any PUT request", section: "Any request" },
        { path: "asa delete", usage: "<path>", summary: "Any DELETE request", section: "Any request" },
        {
          path: "asa docs",
          usage: "[resource [operation] | words]",
          summary: "Every endpoint, with Apple's own schema",
          section: "Reference",
        },
      ],
      examples: [
        ["asa campaigns list --app <app>", "Your campaigns"],
        ["asa reports campaigns --start <yyyy-mm-dd> --end <yyyy-mm-dd>", "A campaign report"],
      ],
    });
  }
  const variants = action ? asaVariants(group, action) : [];
  const [op] = variants;
  if (!op) {
    return renderAsaPage({
      path: `asa ${group}`,
      listing: "Operations",
      usage: "<operation>",
      summary: `Apple Search Ads ${group}`,
      children: asaActions(group).flatMap((name) => {
        const [first] = asaVariants(group, name);
        if (!first) return [];
        return [{ path: `asa ${group} ${name}`, usage: formatAsaUsage(first), summary: first.summary }];
      }),
    });
  }
  return renderAsaPage({
    path: `asa ${group} ${action}`,
    usage: formatAsaUsage(op),
    summary: variants.map((variant) => variant.summary).join("; "),
    flags: formatAsaFlags(op, variants),
    details: `Apple's schema for it: superwall asa docs ${group} ${action}`,
  });
}
