import { app, data, dryRun, project, yes } from "@/program/flags";
import { defineCatalog, type Catalog, type Example, type FlagSpec } from "@/program/command";
import type { Resource } from "./catalog";
import { dispatch } from "./dispatch";
import { renderResourceHelp } from "./help";
import { readResourceFlags } from "./input";
import { assertOperations } from "./operation";
import { listResourceTools } from "./tools";

const FLAGS = {
  app,
  project,
  search: { type: "string", value: "text", describe: "list: only rows whose id, name or identifier contains this" },
  limit: { type: "number", describe: "list: at most this many rows" },
  d: data,
  yes,
  dryRun: { ...dryRun, describe: "Print the request; send nothing" },
  price: { type: "number", value: "amount", describe: "products create: price in major units" },
  periodCount: { type: "number", describe: "products create: periods per cycle" },
  trialDays: { type: "number", describe: "products create: free-trial days" },
  entitlement: { type: "list", value: "id", describe: "products create: entitlement ids to grant" },
} as const satisfies Record<string, FlagSpec>;

export function defineResource(resource: Resource & { examples: readonly Example[] }): Catalog {
  assertOperations(resource);
  return defineCatalog({
    name: resource.name,
    summary: resource.summary,
    examples: resource.examples,
    auth: "required",
    json: true,
    prompts: true,
    mcp: "write",
    flags: FLAGS,
    operations: () => [
      ...resource.operations.map((operation) => operation.name),
      ...(resource.nested ?? []).map((nested) => `${nested.name} …`),
    ],
    help: async (words) => renderResourceHelp(resource, words),
    tools: () => listResourceTools(resource, FLAGS),
    run: (ctx, { words, flags }) => dispatch(ctx, resource, words, readResourceFlags(flags)),
  });
}
