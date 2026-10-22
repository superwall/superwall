/** Whether a `useQueryState` write adds a browser history entry or replaces the current one. */
export type QueryHistory = "push" | "replace";

/** How a `useQueryState` write lands in the URL. User attributes ignore both. */
export type QueryStateOptions = {
  /** Whether a write adds a browser history entry. Defaults to `replace`. */
  history?: QueryHistory;
  /** Drop the key from the URL when the value equals the default. Defaults to true. */
  clearOnDefault?: boolean;
};

/**
 * Reads one stored string — a query value or a user attribute — into a type,
 * and writes it back. The same parser works with `useQueryState`,
 * `useUserAttribute` and `readAttribute`.
 */
export type Parser<T> = QueryStateOptions & {
  /** Reads the raw value, or `null` when it is not one of yours. */
  parse(value: string): T | null;
  /** Writes the value back as a string. Defaults to `String`. */
  serialize(value: T): string;
  /** Compares two values, to know a no-op write. Defaults to `Object.is`. */
  eq(a: T, b: T): boolean;
  /** The value a missing or unreadable key falls back to. */
  defaultValue?: T;
  /** A copy with a default, so the value is never `null`. */
  withDefault(value: T): ParserWithDefault<T>;
  /** A copy with different `useQueryState` write options. */
  withOptions(options: QueryStateOptions): Parser<T>;
};

/** A parser whose value can never be `null`. */
export type ParserWithDefault<T> = Parser<T> & {
  /** The value a missing or unreadable key falls back to. */
  defaultValue: T;
  /** A copy with different `useQueryState` write options, keeping the default. */
  withOptions(options: QueryStateOptions): ParserWithDefault<T>;
};

/** What `createParser` needs: how to read a string, and optionally how to write and compare. */
export type ParserSpec<T> = {
  /** Reads the raw string, or `null` when it is not a value of this type. */
  parse(value: string): T | null;
  /** Writes a value as a string. Defaults to `String`. */
  serialize?(value: T): string;
  /** Compares two values. Defaults to `Object.is`. */
  eq?(a: T, b: T): boolean;
};

const build = <T>(spec: ParserSpec<T>, options: QueryStateOptions): Parser<T> => ({
  parse: spec.parse,
  serialize: spec.serialize ?? String,
  eq: spec.eq ?? Object.is,
  ...options,
  withDefault: (value) => withDefault(build(spec, options), value),
  withOptions: (next) => build(spec, { ...options, ...next }),
});

const withDefault = <T>(parser: Parser<T>, defaultValue: T): ParserWithDefault<T> => ({
  ...parser,
  defaultValue,
  withOptions: (next) => withDefault(parser.withOptions(next), defaultValue),
});

/** A parser for your own type, from a `parse` and optionally a `serialize` and an `eq`. */
export const createParser = <T>(spec: ParserSpec<T>): Parser<T> => build(spec, {});

/** Any string, as is. The parser a key gets when none is passed. */
export const parseAsString = createParser<string>({ parse: (value) => value });

/** A whole number in base 10. Writes round to the nearest integer. */
export const parseAsInteger = createParser<number>({
  parse: (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  },
  serialize: (value) => String(Math.round(value)),
});

/** Any number. */
export const parseAsFloat = createParser<number>({
  parse: (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  },
});

/** `"true"` or `"false"`, and nothing else. */
export const parseAsBoolean = createParser<boolean>({
  parse: (value) => (value === "true" ? true : value === "false" ? false : null),
});

/** One of `values`, typed as their union; anything else reads as missing. */
export const parseAsStringEnum = <const T extends string>(values: readonly T[]): Parser<T> =>
  createParser<T>({
    parse: (value) => values.find((candidate) => candidate === value) ?? null,
  });

/** A list joined by `separator` (a comma by default); items `item` cannot read are dropped. */
export const parseAsArrayOf = <T>(item: Parser<T>, separator = ","): Parser<T[]> =>
  createParser<T[]>({
    parse: (value) =>
      value === ""
        ? []
        : value
            .split(separator)
            .map((one) => item.parse(one))
            .filter((one): one is T => one !== null),
    serialize: (value) => value.map((one) => item.serialize(one)).join(separator),
    eq: (a, b) => a.length === b.length && a.every((one, index) => item.eq(one, b[index])),
  });

export const parseValue = <T>(parser: Parser<T>, raw: string | null): T | null => {
  if (raw === null) return parser.defaultValue ?? null;
  return parser.parse(raw) ?? parser.defaultValue ?? null;
};
