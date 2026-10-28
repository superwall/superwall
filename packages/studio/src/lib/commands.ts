import { RESPONSIVE_ID, STUDIO_DEVICES, type StudioDevice } from "./devices";
import type { VariableOverrides } from "./variables";

/**
 * Everything a person can do from the editor's toolbar, top bar and Variables
 * panel, as data, so a host (an agent beside the studio) can drive the same
 * state the controls do. `SurfaceEditor` applies these through its handle.
 */
export type StudioCommand =
  /** A number is a zoom percentage (`150` is 150%). */
  | { type: "zoom"; to: "in" | "out" | "fit" | "actual" | number }
  /** A device id or name from `STUDIO_DEVICES`, or `"responsive"`. */
  | { type: "device"; device: string }
  /** The responsive frame's size; switches to it. */
  | { type: "size"; width?: number; height?: number }
  | { type: "orientation"; orientation: "portrait" | "landscape" }
  | { type: "theme"; theme: "light" | "dark" }
  /** One of the surface's locales; null follows the device. */
  | { type: "locale"; locale: string | null }
  /** null lets the products decide, as before the switch is touched. */
  | { type: "introductoryOffer"; eligible: boolean | null }
  /**
   * `user.<key>`, `device.<key>`, `params.<key>` or `products.<reference>.<key>`.
   * A null or missing value resets it.
   */
  | { type: "variable"; path: string; value?: unknown }
  | { type: "resetVariables" }
  | { type: "variablesPanel"; open: boolean }
  /** A pushed version, as the version picker lists it. */
  | { type: "version"; version: number }
  /**
   * What the stage compares beside the one on it: compare options' keys or
   * labels (`state.compareOptions`), at most `COMPARE_MAX`, kept in order.
   * One option sets that one; null or an empty list ends the comparison.
   */
  | { type: "compare"; with: string | readonly string[] | null }
  /** Adds an option; at the limit it replaces the one compared longest. */
  | { type: "compareAdd"; with: string }
  | { type: "compareRemove"; with: string }
  /** Swaps a compared option for another in the same place. */
  | { type: "compareSwap"; from: string; to: string }
  /** Puts a draft (`state.drafts`) on stage, the build Push and Publish ship. */
  | { type: "select"; with: string }
  /** Opens or closes Preview on a device; an unsaved paywall asks to push first. */
  | { type: "previewOnDevice"; open: boolean }
  | { type: "reload" };

export type StudioCommandType = StudioCommand["type"];

export const STUDIO_COMMAND_TYPES: readonly StudioCommandType[] = [
  "zoom",
  "device",
  "size",
  "orientation",
  "theme",
  "locale",
  "introductoryOffer",
  "variable",
  "resetVariables",
  "variablesPanel",
  "version",
  "compare",
  "compareAdd",
  "compareRemove",
  "compareSwap",
  "select",
  "previewOnDevice",
  "reload",
];

/** How many options the stage compares beside the one on it: three side by side. */
export const COMPARE_MAX = 2;

/** What the editor shows, as a host reports it back after commands. */
export type StudioState = {
  surface: { id: string; label?: string; version?: number };
  device: { id: string; name: string; width: number; height: number };
  devices: { id: string; name: string }[];
  orientation: "portrait" | "landscape";
  theme: "light" | "dark";
  locale: string | null;
  locales: string[];
  introductoryOffer: { eligible: boolean; overridden: boolean };
  zoom: { percent: number; fitted: boolean };
  variables: VariableOverrides;
  variablesPanel: boolean;
  versions: { version: number; live: boolean }[];
  /** What is on stage: `draft:<key>` for a draft, else `version:<n>` or `surface:<kind>/<id>`. */
  stage: string;
  /** The compared options' keys, in the order they sit on the stage beside it. */
  compare: string[];
  compareMax: number;
  compareOptions: { key: string; label: string; kind: CompareOptionKind }[];
  /** The host's unsaved builds, oldest first; `select` puts one on stage. */
  drafts: { key: string; label: string; onStage: boolean }[];
  previewOnDevice: boolean;
};

export type CompareOptionKind = "origin" | "version" | "draft" | "surface";

export type StudioCommandError = { index: number; type: string; error: string };

export type StudioCommandResult = {
  ok: boolean;
  errors: StudioCommandError[];
  state: StudioState;
};

export type StudioHandle = {
  run: (commands: readonly StudioCommand[]) => Promise<StudioCommandResult>;
  state: () => StudioState;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const parseOne = (value: unknown): StudioCommand | string => {
  const entry = record(value);
  if (!entry) return "a command is an object with a type";
  const type = entry.type;
  switch (type) {
    case "zoom": {
      const to = entry.to;
      if (to === "in" || to === "out" || to === "fit" || to === "actual") return { type, to };
      if (finite(to) && to > 0) return { type, to };
      return "zoom.to is in, out, fit, actual or a percentage";
    }
    case "device":
      return typeof entry.device === "string" && entry.device.trim()
        ? { type, device: entry.device }
        : "device.device is a device id or name";
    case "size": {
      const width = entry.width === undefined ? undefined : entry.width;
      const height = entry.height === undefined ? undefined : entry.height;
      if ((width !== undefined && !finite(width)) || (height !== undefined && !finite(height))) {
        return "size.width and size.height are numbers";
      }
      if (width === undefined && height === undefined) return "size needs a width or a height";
      return {
        type,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
      };
    }
    case "orientation":
      return entry.orientation === "portrait" || entry.orientation === "landscape"
        ? { type, orientation: entry.orientation }
        : "orientation.orientation is portrait or landscape";
    case "theme":
      return entry.theme === "light" || entry.theme === "dark"
        ? { type, theme: entry.theme }
        : "theme.theme is light or dark";
    case "locale":
      return entry.locale === undefined || nullableString(entry.locale)
        ? { type, locale: entry.locale ?? null }
        : "locale.locale is a locale code or null";
    case "introductoryOffer":
      return entry.eligible === undefined ||
        entry.eligible === null ||
        typeof entry.eligible === "boolean"
        ? { type, eligible: entry.eligible ?? null }
        : "introductoryOffer.eligible is true, false or null";
    case "variable":
      return typeof entry.path === "string" && entry.path.trim()
        ? { type, path: entry.path.trim(), value: entry.value }
        : "variable.path is user.<key>, device.<key>, params.<key> or products.<reference>.<key>";
    case "resetVariables":
    case "reload":
      return { type };
    case "variablesPanel":
      return typeof entry.open === "boolean"
        ? { type, open: entry.open }
        : "variablesPanel.open is true or false";
    case "version":
      return finite(entry.version)
        ? { type, version: entry.version }
        : "version.version is a version number";
    case "compare": {
      const wanted = entry.with;
      if (wanted === undefined || nullableString(wanted)) return { type, with: wanted ?? null };
      if (Array.isArray(wanted) && wanted.every((item) => typeof item === "string")) {
        return { type, with: wanted as string[] };
      }
      return "compare.with is a compare option's key or label, a list of them, or null";
    }
    case "compareAdd":
    case "compareRemove":
    case "select":
      return typeof entry.with === "string" && entry.with.trim()
        ? { type, with: entry.with }
        : type === "select"
          ? "select.with is a draft's key or label"
          : `${type}.with is a compare option's key or label`;
    case "compareSwap":
      return typeof entry.from === "string" &&
        entry.from.trim() &&
        typeof entry.to === "string" &&
        entry.to.trim()
        ? { type, from: entry.from, to: entry.to }
        : "compareSwap.from and compareSwap.to are compare options' keys or labels";
    case "previewOnDevice":
      return typeof entry.open === "boolean"
        ? { type, open: entry.open }
        : "previewOnDevice.open is true or false";
    default:
      return `unknown command type ${JSON.stringify(type)}; use one of ${STUDIO_COMMAND_TYPES.join(", ")}`;
  }
};

/** Checks commands that arrive as untrusted JSON (from an agent, over a bridge). */
export const parseStudioCommands = (
  value: unknown,
): { ok: true; commands: StudioCommand[] } | { ok: false; error: string } => {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "commands is a non-empty list" };
  }
  const commands: StudioCommand[] = [];
  for (const [index, entry] of value.entries()) {
    const parsed = parseOne(entry);
    if (typeof parsed === "string") return { ok: false, error: `commands[${index}]: ${parsed}` };
    commands.push(parsed);
  }
  return { ok: true, commands };
};

const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * A device by id or by name, loosely: `iPhone 17 Pro` and `iphone-17-pro`
 * both match, and `iPad Pro` matches `iPad Pro 11″` when no other device
 * starts that way.
 */
export const findDevice = (query: string): StudioDevice | typeof RESPONSIVE_ID | undefined => {
  const wanted = normalized(query);
  if (wanted === RESPONSIVE_ID) return RESPONSIVE_ID;
  if (!wanted) return undefined;
  const exact = STUDIO_DEVICES.find(
    (device) => normalized(device.id) === wanted || normalized(device.name) === wanted,
  );
  if (exact) return exact;
  const started = STUDIO_DEVICES.filter((device) => normalized(device.name).startsWith(wanted));
  return started.length === 1 ? started[0] : undefined;
};

const VARIABLE_GROUPS = ["user", "device", "params"] as const;

type Edit = { overrides: VariableOverrides } | { error: string };

/** One Variables panel edit, as `variable` commands name it; a null value resets the path. */
export const editVariable = (overrides: VariableOverrides, path: string, value: unknown): Edit => {
  const [group, ...rest] = path.split(".");
  const reset = value === undefined || value === null;
  if (group === "products") {
    const [reference, ...key] = rest;
    const name = key.join(".");
    if (!reference || !name) return { error: `${path} is not products.<reference>.<key>` };
    const products = { ...overrides.products };
    const slot = { ...products[reference] };
    if (reset) delete slot[name];
    else slot[name] = value;
    if (Object.keys(slot).length > 0) products[reference] = slot;
    else delete products[reference];
    return { overrides: { ...overrides, products } };
  }
  const known = VARIABLE_GROUPS.find((entry) => entry === group);
  const name = rest.join(".");
  if (!known || !name) {
    return {
      error: `${path} is not user.<key>, device.<key>, params.<key> or products.<reference>.<key>`,
    };
  }
  const next = { ...overrides[known] };
  if (reset) delete next[name];
  else next[name] = value;
  return { overrides: { ...overrides, [known]: next } };
};

/** A Variables panel's overrides without the switch it does not own. */
export const variableOverrides = (edited: VariableOverrides): VariableOverrides => {
  const { introductoryOfferEligible: _offer, ...rest } = edited;
  return rest;
};
