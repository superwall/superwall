import * as React from "react";
import { ColumnsIcon } from "../icons";
import type { CompareTarget } from "../../lib/surfaces";

export type CompareOption = {
  key: string;
  label: string;
  hint: string;
  target: CompareTarget;
};

const Row = ({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-cream/5"
    aria-current={selected || undefined}
    onClick={onSelect}
  >
    <span className="flex max-w-full items-center gap-1.5 text-[0.8125rem] font-medium">
      <span className="truncate">{label}</span>
      {selected && (
        <span className="bg-accent size-[5px] shrink-0 rounded-full" aria-hidden="true" />
      )}
    </span>
    <span className="max-w-full truncate text-xs text-cream/55">{hint}</span>
  </button>
);

export const CompareMenu = ({
  active,
  options,
  onSelect,
}: {
  active: CompareTarget | undefined;
  options: CompareOption[];
  onSelect: (target: CompareTarget | undefined) => void;
}) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !event.composedPath().includes(menuRef.current)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const activeKey =
    active &&
    (active.type === "live" ? "live" : `surface:${active.surface.kind}/${active.surface.id}`);

  const choose = (target: CompareTarget | undefined) => {
    setOpen(false);
    onSelect(target);
  };

  const needle = query.trim().toLowerCase();
  const live = options.filter((option) => option.key === "live");
  const paywalls = options
    .filter((option) => option.key !== "live")
    .filter(
      (option) => needle === "" || `${option.label} ${option.hint}`.toLowerCase().includes(needle),
    );

  return (
    <div className="relative flex" ref={menuRef}>
      <button
        type="button"
        className="sw-btn"
        aria-pressed={active !== undefined}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ColumnsIcon />
        Compare
      </button>

      {open && (
        <div className="bg-bar absolute bottom-full left-0 z-20 mb-1 flex w-72 flex-col overflow-hidden rounded border border-cream/20">
          <div className="p-2">
            <input
              className="sw-input"
              type="search"
              value={query}
              placeholder="Search paywalls"
              aria-label="Search paywalls"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {paywalls.length === 0 ? (
              <span className="block px-3 pt-2 pb-4 text-[0.8125rem] text-cream/45">
                {needle === "" ? "No other paywalls here." : `Nothing matches “${query.trim()}”.`}
              </span>
            ) : (
              paywalls.map((option) => (
                <Row
                  key={option.key}
                  label={option.label}
                  hint={option.hint}
                  selected={option.key === activeKey}
                  onSelect={() => choose(option.target)}
                />
              ))
            )}
          </div>

          <div className="flex flex-col border-t border-cream/10">
            {live.map((option) => (
              <Row
                key={option.key}
                label={option.label}
                hint={option.hint}
                selected={option.key === activeKey}
                onSelect={() => choose(option.target)}
              />
            ))}
            <Row
              label="Off"
              hint="A single preview"
              selected={active === undefined}
              onSelect={() => choose(undefined)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
