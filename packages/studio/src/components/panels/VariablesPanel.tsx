import * as React from "react";
import { Switch } from "../controls";
import { ChevronDownIcon, SearchIcon } from "../icons";
import type { VariableOverrides } from "../../lib/variables";

export type VariableGroup = "user" | "device" | "params" | "products";

export type VariableRow = {
  path: string;
  value: unknown;
};

export type VariableGroups = Partial<Record<VariableGroup, VariableRow[]>>;

const GROUPS: { key: VariableGroup; label: string; blurb: string }[] = [
  { key: "user", label: "User", blurb: "Attributes your app sets" },
  { key: "device", label: "Device", blurb: "Platform, locale, OS — the SDK fills these in" },
  { key: "params", label: "Params", blurb: "Passed in at the placement" },
  { key: "products", label: "Products", blurb: "Store data for this paywall’s products" },
];

const display = (value: unknown): string =>
  value === undefined || value === null
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value);

const parse = (value: string): unknown => {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
};

const leaf = (path: string): string => path.slice(path.indexOf(".") + 1);

const Row = ({
  row,
  override,
  onChange,
}: {
  row: VariableRow;
  override: unknown;
  onChange: (value: unknown) => void;
}) => {
  const overridden = override !== undefined;
  const current = overridden ? override : row.value;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-fg-tertiary">{row.path}</span>
        {overridden && (
          <button
            type="button"
            className="sw-btn sw-btn--plain shrink-0 text-xs"
            aria-label={`Reset ${row.path}`}
            onClick={() => onChange(undefined)}
          >
            Reset
          </button>
        )}
      </div>
      {typeof current === "boolean" ? (
        <span className="flex h-7 items-center">
          <Switch label={row.path} checked={current} onChange={(checked) => onChange(checked)} />
        </span>
      ) : (
        <input
          className="sw-input sw-input--sm"
          aria-label={row.path}
          value={display(current)}
          placeholder={display(row.value)}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next === "" ? undefined : parse(next));
          }}
        />
      )}
    </div>
  );
};

const Group = ({
  label,
  blurb,
  rows,
  overrideOf,
  onChange,
  searching,
}: {
  label: string;
  blurb: string;
  rows: VariableRow[];
  searching: boolean;
  overrideOf: (path: string) => unknown;
  onChange: (path: string, value: unknown) => void;
}) => {
  const [chosen, setState] = React.useState<"closed" | "open" | "closing">("closed");
  const state = searching ? "open" : chosen;
  const open = state === "open";
  const overridden = rows.filter((row) => overrideOf(row.path) !== undefined).length;

  return (
    <section className="border-b border-border">
      <button
        type="button"
        className="group relative flex w-full items-center gap-4 px-4 py-2.5 text-left transition-colors duration-hover before:pointer-events-none before:absolute before:inset-0 before:border before:border-transparent before:transition-colors before:duration-hover hover:bg-foreground/3 focus-visible:before:border-primary"
        aria-expanded={open}
        onClick={() => setState((current) => (current === "open" ? "closing" : "open"))}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {label}
            {overridden > 0 ? (
              <span className="font-normal text-primary tabular-nums">{`${overridden} set`}</span>
            ) : (
              rows.length > 0 && (
                <span className="font-normal text-fg-tertiary tabular-nums">{rows.length}</span>
              )
            )}
          </span>
          <span className="truncate text-xs/4 text-fg-tertiary">{blurb}</span>
        </span>
        <ChevronDownIcon
          className={`icon-tertiary transition-disclosure group-hover:filter-none ${open ? "rotate-180" : ""}`}
        />
      </button>

      {state !== "closed" && (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-move ease-out starting:grid-rows-[0fr] starting:opacity-0 ${
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
          aria-hidden={open ? undefined : true}
          inert={!open}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && state === "closing") setState("closed");
          }}
        >
          <div className="min-h-0 overflow-hidden">
            {rows.length === 0 ? (
              <span className="block px-4 pb-4 text-xs text-fg-tertiary">
                Nothing here for this paywall.
              </span>
            ) : (
              <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
                {rows.map((row) => (
                  <Row
                    key={row.path}
                    row={row}
                    override={overrideOf(row.path)}
                    onChange={(value) => onChange(row.path, value)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export const VariablesPanel = ({
  overrides,
  groups,
  onChange,
}: {
  overrides: VariableOverrides;
  groups: VariableGroups;
  onChange: (overrides: VariableOverrides) => void;
}) => {
  const update = (group: VariableGroup, path: string, value: unknown) => {
    if (group !== "products") {
      const current = { ...overrides[group] } as Record<string, unknown>;
      if (value === undefined) delete current[leaf(path)];
      else current[leaf(path)] = value;
      onChange({ ...overrides, [group]: current });
      return;
    }

    const [, reference = "", key = ""] = path.split(".");
    const slot = { ...overrides.products?.[reference] };
    if (value === undefined) delete slot[key];
    else slot[key] = value;
    const next = { ...overrides.products, [reference]: slot };
    if (Object.keys(slot).length === 0) delete next[reference];
    onChange({ ...overrides, products: next });
  };

  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();
  const matching = (rows: VariableRow[]) =>
    needle === "" ? rows : rows.filter((row) => row.path.toLowerCase().includes(needle));
  const shown = GROUPS.filter(
    (group) => needle === "" || matching(groups[group.key] ?? []).length > 0,
  );

  return (
    <div className="flex flex-col">
      <div className="border-b border-border p-3">
        <label className="relative flex items-center">
          <SearchIcon className="icon-tertiary pointer-events-none absolute left-2.5" />
          <input
            className="sw-input sw-input--sm w-full pl-8"
            type="search"
            aria-label="Search variables"
            placeholder="Search variables"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {shown.length === 0 && (
        <span className="block px-4 py-4 text-xs text-fg-tertiary">No variables match.</span>
      )}
      {shown.map((group) => (
        <Group
          key={group.key}
          label={group.label}
          blurb={group.blurb}
          searching={needle !== ""}
          rows={matching(groups[group.key] ?? [])}
          overrideOf={(path) =>
            group.key === "products"
              ? overrides.products?.[path.split(".")[1] ?? ""]?.[path.split(".")[2] ?? ""]
              : (overrides[group.key] as Record<string, unknown> | undefined)?.[leaf(path)]
          }
          onChange={(path, value) => update(group.key, path, value)}
        />
      ))}
    </div>
  );
};
