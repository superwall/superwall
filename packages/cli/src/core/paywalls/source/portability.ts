import { ui } from "@/ui";

const SHOWN = 5;

export function portabilityWarning(external: Iterable<string>): string | undefined {
  const names = [...new Set(external)].filter((entry) => entry.trim() !== "").sort();
  if (names.length === 0) return undefined;

  const shown = names.slice(0, SHOWN).join(", ");
  const rest = names.length - SHOWN;
  return (
    `${names.length} ${names.length === 1 ? "import resolves" : "imports resolve"} outside ` +
    `superwall/ (${shown}${rest > 0 ? `, and ${rest} more` : ""}) — this project can be edited ` +
    "locally only; remote editing and rebuilds won't be available. For full feature access, move " +
    "them into superwall/components/ or install from a package registry."
  );
}

export function warnNotPortable(external: Iterable<string>): void {
  const message = portabilityWarning(external);
  if (message) ui.warn(message);
}
