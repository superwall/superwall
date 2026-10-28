import { COMPARE_MAX } from "./commands";

/** `key` compared last; past the limit the one compared longest makes room. */
export const compareAdded = (
  list: readonly string[],
  key: string,
  max: number = COMPARE_MAX,
): string[] => [...list.filter((entry) => entry !== key), key].slice(-max);

/** `to` in `from`'s place; when `to` is compared already, `from` just goes. */
export const compareSwapped = (list: readonly string[], from: string, to: string): string[] =>
  list.includes(to)
    ? list.filter((entry) => entry !== from)
    : list.map((entry) => (entry === from ? to : entry));

/**
 * Drafts the stage has not seen yet join the comparison, newest last, so a
 * fresh batch of builds replaces the oldest ones on the stage.
 */
export const followDrafts = (
  list: readonly string[],
  seen: ReadonlySet<string>,
  drafts: readonly string[],
  max: number = COMPARE_MAX,
): string[] =>
  drafts.reduce<string[]>(
    (next, key) => (seen.has(key) ? next : compareAdded(next, key, max)),
    [...list],
  );
