import type { Endpoint } from "@/program/command";

export type CommandLookup = (endpoint: Endpoint) => string | undefined;

export async function resolveCommandLookup(): Promise<CommandLookup> {
  const { listGroups } = await import("@/commands/registry");
  const catalogs = listGroups().flatMap((group) => group.commands.flatMap((command) => (command.kind === "catalog" && command.commandFor ? [command.commandFor] : [])));
  return (endpoint) => {
    for (const commandFor of catalogs) {
      const found = commandFor(endpoint);
      if (found) return found;
    }
    return undefined;
  };
}

export function withCommand<T extends Endpoint>(op: T, lookup: CommandLookup): T & { command?: string } {
  const command = lookup(op);
  return command ? { ...op, command } : op;
}
