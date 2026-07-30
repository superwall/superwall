import * as React from "react";
import { ChevronDownIcon } from "./icons";
import type { PreviewOverrides } from "../lib/types";

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
  { key: "products", label: "Products", blurb: "Store data for this paywall's products" },
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
    <div className="flex flex-col gap-1 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-cream/70">{row.path}</span>
        {overridden && (
          <button
            type="button"
            className="shrink-0 text-[11px] text-cream/40 hover:text-cream"
            aria-label={`Reset ${row.path}`}
            onClick={() => onChange(undefined)}
          >
            Reset
          </button>
        )}
      </div>
      {typeof current === "boolean" ? (
        <span className="flex h-7 items-center">
          <button
            type="button"
            className="sw-switch"
            role="switch"
            aria-checked={current}
            aria-label={row.path}
            onClick={() => onChange(!current)}
          />
        </span>
      ) : (
        <input
          className="sw-input w-full"
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
}: {
  label: string;
  blurb: string;
  rows: VariableRow[];
  overrideOf: (path: string) => unknown;
  onChange: (path: string, value: unknown) => void;
}) => {
  const [open, setOpen] = React.useState(false);
  const overridden = rows.filter((row) => overrideOf(row.path) !== undefined).length;

  return (
    <section className="border-b border-cream/10 last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 py-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="text-[0.8125rem] font-medium text-cream">{label}</span>
            <span className="text-xs text-cream/40">
              {overridden > 0 ? (
                <span className="text-accent">{`${overridden} set`}</span>
              ) : (
                rows.length || null
              )}
            </span>
          </span>
          <span className="truncate text-xs text-cream/55">{blurb}</span>
        </span>
        <span
          className={`ml-auto shrink-0 text-cream/40 transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden="true"
        >
          <ChevronDownIcon />
        </span>
      </button>

      {open &&
        (rows.length === 0 ? (
          <span className="block pb-3 text-xs text-cream/35">Nothing here for this paywall.</span>
        ) : (
          <div className="flex flex-col pb-2">
            {rows.map((row) => (
              <Row
                key={row.path}
                row={row}
                override={overrideOf(row.path)}
                onChange={(value) => onChange(row.path, value)}
              />
            ))}
          </div>
        ))}
    </section>
  );
};

export const VariablesPanel = ({
  overrides,
  groups,
  onChange,
}: {
  overrides: PreviewOverrides;
  groups: VariableGroups;
  onChange: (overrides: PreviewOverrides) => void;
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

  return (
    <div className="flex flex-col">
      {GROUPS.map((group) => (
        <Group
          key={group.key}
          label={group.label}
          blurb={group.blurb}
          rows={groups[group.key] ?? []}
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
