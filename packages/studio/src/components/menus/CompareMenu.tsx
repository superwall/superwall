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

const Heading = ({ children }: React.PropsWithChildren) => (
  <span className="block px-3 pt-2 pb-1 text-[0.6875rem] tracking-wide text-cream/45 uppercase">
    {children}
  </span>
);

export const CompareMenu = ({
  active,
  options,
  notice,
  onSelect,
}: {
  active: CompareTarget | undefined;
  options: CompareOption[];
  notice?: string;
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
    (active.type === "version"
      ? `version:${active.version}`
      : `surface:${active.surface.kind}/${active.surface.id}`);

  const choose = (target: CompareTarget | undefined) => {
    setOpen(false);
    onSelect(target);
  };

  const needle = query.trim().toLowerCase();
  const matches = (option: CompareOption) =>
    needle === "" || `${option.label} ${option.hint}`.toLowerCase().includes(needle);
  const versions = options.filter((option) => option.target.type === "version").filter(matches);
  const paywalls = options.filter((option) => option.target.type === "surface").filter(matches);
  const grouped = versions.length > 0 && paywalls.length > 0;
  const rows = (group: CompareOption[]) =>
    group.map((option) => (
      <Row
        key={option.key}
        label={option.label}
        hint={option.hint}
        selected={option.key === activeKey}
        onSelect={() => choose(option.target)}
      />
    ));

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
              placeholder="Search versions and paywalls"
              aria-label="Search versions and paywalls"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {versions.length + paywalls.length === 0 ? (
              <span className="block px-3 pt-2 pb-4 text-[0.8125rem] text-cream/45">
                {needle === ""
                  ? "No pushed versions or other paywalls here."
                  : `Nothing matches “${query.trim()}”.`}
              </span>
            ) : (
              <>
                {grouped && <Heading>Versions</Heading>}
                {rows(versions)}
                {grouped && <Heading>Paywalls</Heading>}
                {rows(paywalls)}
              </>
            )}
          </div>

          <div className="flex flex-col border-t border-cream/10">
            {notice && (
              <span className="block px-3 pt-2 text-xs text-cream/55" role="status">
                {notice}
              </span>
            )}
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
