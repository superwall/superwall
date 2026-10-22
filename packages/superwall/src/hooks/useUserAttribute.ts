import * as React from "react";
import { parseAsString, parseValue, type Parser, type ParserWithDefault } from "../parsers";
import { useSuperwallSession } from "../provider/context";

export {
  createParser,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsFloat,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  type Parser,
  type ParserSpec,
  type ParserWithDefault,
} from "../parsers";

/** User attributes as a paywall receives them: whatever the app and the paywall have set. */
export type UserAttributes = Readonly<Record<string, unknown>>;

/** A new value, or a function from the current one to the new one. Never `null`. */
export type UserAttributeUpdate<T, Current = T | null> = T | ((previous: Current) => T);

/** Writes one user attribute. */
export type SetUserAttribute<T, Current = T | null> = (
  value: UserAttributeUpdate<T, Current>,
) => void;

const MISSING = new Set(["null", "undefined"]);

const textOf = (raw: unknown): string | null => {
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw !== "string" || MISSING.has(raw)) return null;
  return raw;
};

/**
 * Reads one user attribute through a parser — the same read `useUserAttribute`
 * makes, as a plain function, for `entry` and anything else outside a
 * component. A missing attribute, one the parser cannot read, an object, and
 * the strings `"null"` and `"undefined"` are all `null`, or the parser's
 * default. Numbers and booleans an app set read as their string form, the
 * same string a paywall would have written for them.
 *
 * ```ts
 * export const entry: Entry = ({ user }) =>
 *   readAttribute(user, "onboarding_goal", goals) ? ["index", "goal", "level"] : "index";
 * ```
 */
export function readAttribute(user: UserAttributes, key: string): string | null;
export function readAttribute<T>(
  user: UserAttributes,
  key: string,
  parser: ParserWithDefault<T>,
): T;
export function readAttribute<T>(user: UserAttributes, key: string, parser: Parser<T>): T | null;
export function readAttribute(
  user: UserAttributes,
  key: string,
  parser: Parser<unknown> = parseAsString,
): unknown {
  return parseValue(parser, textOf(user[key]));
}

const isUpdater = <T, Current>(
  update: UserAttributeUpdate<T, Current>,
): update is (previous: Current) => T => typeof update === "function";

/**
 * One user attribute as typed state — `useState` that the host SDK keeps
 * across presentations and launches, and that campaigns and analytics can
 * read. `useQueryState`'s API, with the same parsers.
 *
 * The value is the attribute read through `parser` (a plain string without
 * one), or `null` when it is missing or unreadable; `.withDefault()` removes
 * `null` from the type. The setter serializes with the parser, sends the
 * attribute to the host and re-renders at once. It takes a value or an
 * updater, and is stable across renders. A paywall cannot remove an
 * attribute, so the setter has no `null`: a `null` or `undefined` is ignored
 * with a console warning rather than stored as the string `"null"`, and
 * writing the value already stored sends nothing.
 *
 * ```tsx
 * const goals = parseAsStringEnum(["lose", "build", "endure"]);
 * const [goal, setGoal] = useUserAttribute("onboarding_goal", goals);
 * setGoal("build");
 * ```
 */
export function useUserAttribute(key: string): [string | null, SetUserAttribute<string>];
export function useUserAttribute<T>(
  key: string,
  parser: ParserWithDefault<T>,
): [T, SetUserAttribute<T, T>];
export function useUserAttribute<T>(
  key: string,
  parser: Parser<T>,
): [T | null, SetUserAttribute<T>];
export function useUserAttribute(
  key: string,
  parser: Parser<unknown> = parseAsString,
): [unknown, (value: never) => void] {
  const session = useSuperwallSession();
  const read = React.useCallback(() => session.getSnapshot().user[key], [session, key]);
  const raw = React.useSyncExternalStore(session.subscribe, read, read);
  const value = React.useMemo(() => parseValue(parser, textOf(raw)), [parser, raw]);
  const current = React.useRef(parser);
  current.current = parser;

  const set = React.useCallback<SetUserAttribute<unknown, unknown>>(
    (update) => {
      const stored = textOf(session.getSnapshot().user[key]);
      const next = isUpdater(update) ? update(parseValue(current.current, stored)) : update;
      if (next === null || next === undefined) {
        console.warn(
          `useUserAttribute("${key}") ignored ${String(next)}: a paywall cannot remove a user attribute.`,
        );
        return;
      }
      const text = current.current.serialize(next);
      if (text !== stored) session.setUserAttributes({ [key]: text });
    },
    [key, session],
  );

  return [value, set];
}
