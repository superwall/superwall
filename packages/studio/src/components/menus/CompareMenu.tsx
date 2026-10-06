import * as React from "react";
import { ColumnsIcon, SearchIcon } from "../icons";
import {
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  useDismiss,
  usePopupAlign,
} from "./Menu";
import type { CompareTarget } from "../../lib/surfaces";

export type CompareOption = {
  key: string;
  label: string;
  hint: string;
  target: CompareTarget;
};

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

  const popupRef = React.useRef<HTMLDivElement>(null);
  const dismissRefs = React.useMemo(() => [menuRef, popupRef], []);
  useDismiss(dismissRefs, open, () => setOpen(false));
  const align = usePopupAlign(menuRef, open);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const activeKey =
    active &&
    (active.type === "version"
      ? `version:${active.version}`
      : active.type === "origin"
        ? "origin"
        : `surface:${active.surface.kind}/${active.surface.id}`);

  const choose = (target: CompareTarget | undefined) => {
    setOpen(false);
    onSelect(target);
  };

  const needle = query.trim().toLowerCase();
  const matches = (option: CompareOption) =>
    needle === "" || `${option.label} ${option.hint}`.toLowerCase().includes(needle);
  const origins = options.filter((option) => option.target.type === "origin").filter(matches);
  const versions = options.filter((option) => option.target.type === "version").filter(matches);
  const paywalls = options.filter((option) => option.target.type === "surface").filter(matches);
  const rows = (group: CompareOption[]) =>
    group.map((option) => (
      <MenuItem
        key={option.key}
        label={option.label}
        hint={option.hint}
        selected={option.key === activeKey}
        onSelect={() => choose(option.target)}
      />
    ));
  const groups = [
    { label: "Rebuilt from", options: origins },
    { label: "Versions", options: versions },
    { label: "Paywalls", options: paywalls },
  ].filter((group) => group.options.length > 0);
  const grouped = groups.length > 1;

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
        <MenuPopup popupRef={popupRef} anchor={menuRef} side="top" align={align} className="w-72">
          <label className="flex items-center gap-2.5 border-b border-border ps-3 pe-2.5">
            <SearchIcon className="icon-tertiary" />
            <input
              className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-fg-muted"
              type="search"
              value={query}
              placeholder="Search versions and paywalls"
              aria-label="Search versions and paywalls"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div
            className="flex max-h-64 scroll-fade flex-col gap-1.5 overflow-y-auto p-1"
            data-menu-list=""
          >
            {groups.length === 0 ? (
              <span className="block px-2.5 py-1 text-sm text-fg-tertiary">
                {needle === ""
                  ? "No pushed versions or other paywalls"
                  : `No versions or paywalls match “${query.trim()}”`}
              </span>
            ) : (
              groups.map((group) => (
                <div key={group.label} className="flex flex-col">
                  {grouped && <MenuGroupLabel>{group.label}</MenuGroupLabel>}
                  {rows(group.options)}
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col border-t border-border p-1">
            {notice && (
              <>
                <span className="block px-2.5 py-1.5 text-xs text-fg-secondary" role="status">
                  {notice}
                </span>
                <MenuSeparator />
              </>
            )}
            <MenuItem
              label="Off"
              hint="A single preview"
              selected={active === undefined}
              onSelect={() => choose(undefined)}
            />
          </div>
        </MenuPopup>
      )}
    </div>
  );
};
