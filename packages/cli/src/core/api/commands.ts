import type { AnyCommand, Endpoint } from "@/program/command";

export type CommandLookup = (endpoint: Endpoint) => string | undefined;

let listCommands: (() => readonly AnyCommand[]) | undefined;

export function useCommandList(list: () => readonly AnyCommand[]): void {
  listCommands = list;
}

export function resolveCommandLookup(): CommandLookup {
  if (!listCommands) throw new Error("The command registry isn't loaded, so no endpoint can be matched to a command.");
  const catalogs = listCommands().flatMap((command) => (command.kind === "catalog" && command.commandFor ? [command.commandFor] : []));
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
