import { UsageError, type CommandContext } from "@/program/command";
import { findNested, findOperation, type Resource } from "./catalog";
import { nestedHelp, resourceHelp } from "./help";
import type { ResourceFlags } from "./input";
import { runOperation } from "./operation";

export async function dispatch(
  ctx: CommandContext<"required">,
  owner: Resource,
  words: readonly string[],
  flags: ResourceFlags,
): Promise<void> {
  let rest = [...words];
  const nested = rest[0] ? findNested(owner, rest[0]) : undefined;
  if (nested) rest = rest.slice(1);
  const resource = nested ?? owner;
  const command = nested ? `${owner.name} ${nested.name}` : owner.name;

  if (rest[0] && /^(\d+|https?:\/\/.*)$/.test(rest[0]) && findOperation(resource, "get")) {
    rest = ["get", ...rest];
  }
  const [opName, ...args] = rest;
  if (!opName) {
    if (!nested && findOperation(owner, "list")) return dispatch(ctx, owner, ["list"], flags);
    process.stdout.write(nested ? nestedHelp(owner, nested) : resourceHelp(owner));
    return;
  }
  const op = findOperation(resource, opName);
  if (!op) {
    const known = resource.operations.map((candidate) => candidate.name);
    const nestedNames = nested ? [] : (owner.nested ?? []).map((candidate) => candidate.name);
    throw new UsageError(
      `${command} has no "${opName}". It takes: ${[...known, ...nestedNames].join(", ")}.\n` +
        `Run superwall ${command} --help for what each does.`,
      command,
    );
  }
  await runOperation(ctx, owner, resource, op, args, flags);
}
