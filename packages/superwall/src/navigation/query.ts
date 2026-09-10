import * as React from "react";

export const REPLACE_THROTTLE_MS = 300;
export const RESERVED_PREFIX = "sw_";
export const RESERVED_KEYS: readonly string[] = ["platform", "transport"];

export type QueryHistory = "push" | "replace";

export type QueryStateOptions = {
  /** Whether a write adds a browser history entry. Defaults to `replace`. */
  history?: QueryHistory;
  /** Drop the key from the URL when the value equals the default. Defaults to true. */
  clearOnDefault?: boolean;
};

/** Reads one query value into a type, and writes it back. */
export type Parser<T> = QueryStateOptions & {
  /** Reads the raw value, or `null` when it is not one of yours. */
  parse(value: string): T | null;
  /** Writes the value into the URL. Defaults to `String`. */
  serialize(value: T): string;
  /** Compares two values, to know a no-op write. Defaults to `Object.is`. */
  eq(a: T, b: T): boolean;
  /** The value a missing or unreadable key falls back to. */
  defaultValue?: T;
  /** A copy with a default, so the state is never `null`. */
  withDefault(value: T): ParserWithDefault<T>;
  /** A copy with different write options. */
  withOptions(options: QueryStateOptions): Parser<T>;
};

/** A parser whose state can never be `null`. */
export type ParserWithDefault<T> = Parser<T> & {
  defaultValue: T;
  withOptions(options: QueryStateOptions): ParserWithDefault<T>;
};

type ParserSpec<T> = {
  parse(value: string): T | null;
  serialize?(value: T): string;
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

export const createParser = <T>(spec: ParserSpec<T>): Parser<T> => build(spec, {});

export const parseAsString = createParser<string>({ parse: (value) => value });

export const parseAsInteger = createParser<number>({
  parse: (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  },
  serialize: (value) => String(Math.round(value)),
});

export const parseAsFloat = createParser<number>({
  parse: (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  },
});

export const parseAsBoolean = createParser<boolean>({
  parse: (value) => (value === "true" ? true : value === "false" ? false : null),
});

export const parseAsStringEnum = <const T extends string>(values: readonly T[]): Parser<T> =>
  createParser<T>({
    parse: (value) => values.find((candidate) => candidate === value) ?? null,
  });

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

export type QueryPatch = Record<string, string | null>;

export type QueryStore = {
  get(key: string): string | null;
  subscribe(listener: () => void): () => void;
  set(patch: QueryPatch, history: QueryHistory): void;
};

const encodePart = (raw: string): string =>
  encodeURIComponent(raw)
    .replaceAll("%2C", ",")
    .replaceAll("%2F", "/")
    .replaceAll("%3A", ":")
    .replaceAll("%20", "+");

export const renderQuery = (params: URLSearchParams): string => {
  const pairs: string[] = [];
  for (const [key, value] of params) pairs.push(`${encodePart(key)}=${encodePart(value)}`);
  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
};

const apply = (params: URLSearchParams, patch: QueryPatch): boolean => {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      if (params.has(key)) {
        params.delete(key);
        changed = true;
      }
    } else if (params.get(key) !== value) {
      params.set(key, value);
      changed = true;
    }
  }
  return changed;
};

/**
 * One in-memory view of the query string that hooks and the router share.
 * With a URL behind it, writes land on `window.location` — replaces are
 * coalesced so a text input cannot trip Safari's history rate limit, and a
 * pending write is flushed before the page is hidden so nothing is lost when
 * a link leaves for the OS browser or hosted checkout. Without one (native
 * hosts, servers) it is plain state with the same shape, so a paywall reads
 * identically everywhere.
 */
export const createQueryStore = (url: boolean): QueryStore => {
  const live = url && typeof window !== "undefined";
  let params = new URLSearchParams(live ? window.location.search : "");
  const listeners = new Set<() => void>();
  const pending = new Map<string, string | null>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const flush = (history: QueryHistory) => {
    cancel();
    if (pending.size === 0) return;
    const patch = Object.fromEntries(pending);
    pending.clear();
    const next = new URLSearchParams(window.location.search);
    apply(next, patch);
    params = next;
    try {
      window.history[history === "push" ? "pushState" : "replaceState"](
        window.history.state,
        "",
        `${window.location.pathname}${renderQuery(next)}${window.location.hash}`,
      );
    } catch {}
  };

  if (live) {
    window.addEventListener("popstate", () => {
      cancel();
      pending.clear();
      params = new URLSearchParams(window.location.search);
      notify();
    });
    window.addEventListener("pagehide", () => flush("replace"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush("replace");
    });
  }

  return {
    get: (key) => params.get(key),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (patch, history) => {
      const next = new URLSearchParams(params);
      if (!apply(next, patch)) return;
      params = next;
      notify();
      if (!live) return;
      for (const [key, value] of Object.entries(patch)) pending.set(key, value);
      if (history === "push") flush("push");
      else if (timer === undefined) timer = setTimeout(() => flush("replace"), REPLACE_THROTTLE_MS);
    },
  };
};

export const QueryStoreContext = React.createContext<QueryStore | null>(null);

const useQueryStore = (key: string): QueryStore => {
  if (key.startsWith(RESERVED_PREFIX) || RESERVED_KEYS.includes(key)) {
    throw new Error(
      `The query key "${key}" is reserved by superwall (${RESERVED_PREFIX}* and ${RESERVED_KEYS.join(", ")})`,
    );
  }

  const store = React.useContext(QueryStoreContext);
  if (!store) {
    throw new Error("useQueryState() must be used inside a paywall mounted by superwall");
  }

  return store;
};

const read = <T>(parser: Parser<T>, raw: string | null): T | null => {
  if (raw === null) return parser.defaultValue ?? null;
  return parser.parse(raw) ?? parser.defaultValue ?? null;
};

const encode = <T>(
  parser: Parser<T>,
  value: T | null,
  options: QueryStateOptions,
): string | null => {
  if (value === null) return null;
  const clear = options.clearOnDefault ?? parser.clearOnDefault ?? true;
  if (clear && parser.defaultValue !== undefined && parser.eq(value, parser.defaultValue)) {
    return null;
  }
  return parser.serialize(value);
};

export type QueryUpdate<T> = T | null | ((previous: T) => T | null);

export type SetQueryState<T> = (value: QueryUpdate<T>, options?: QueryStateOptions) => void;

const isUpdater = <T>(update: QueryUpdate<T>): update is (previous: T) => T | null =>
  typeof update === "function";

/**
 * State that lives in the page URL — `useState` whose value survives a
 * reload, a hand-off from an in-app browser to the OS browser, or a trip
 * through hosted checkout. On a native host the URL is out of reach and the
 * same hook is plain shared state, so a flow reads identically everywhere.
 *
 * Pass a parser for anything but a string; `.withDefault()` removes `null`
 * from the type and clears the key whenever the value equals the default.
 */
export function useQueryState(key: string): [string | null, SetQueryState<string | null>];
export function useQueryState<T>(key: string, parser: ParserWithDefault<T>): [T, SetQueryState<T>];
export function useQueryState<T>(
  key: string,
  parser: Parser<T>,
): [T | null, SetQueryState<T | null>];
export function useQueryState(
  key: string,
  parser: Parser<unknown> = parseAsString,
): [unknown, (value: never, options?: QueryStateOptions) => void] {
  const store = useQueryStore(key);
  const raw = React.useSyncExternalStore(
    store.subscribe,
    () => store.get(key),
    () => store.get(key),
  );
  const current = React.useRef(parser);
  current.current = parser;
  const value = React.useMemo(() => read(parser, raw), [parser, raw]);
  const latest = React.useRef(value);
  latest.current = value;

  const set = React.useCallback<SetQueryState<unknown>>(
    (update, options = {}) => {
      const next = isUpdater(update) ? update(latest.current) : update;
      store.set(
        { [key]: encode(current.current, next, options) },
        options.history ?? current.current.history ?? "replace",
      );
    },
    [key, store],
  );

  return [value, set];
}
