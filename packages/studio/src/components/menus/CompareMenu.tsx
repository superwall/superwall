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

/**
 * What the stage compares beside the surface on it, several at once: a row
 * toggles its option, and Off ends the comparison. At the limit, the host
 * replaces the option compared longest.
 */
export const CompareMenu = ({
  active,
  options,
  notice,
  limit,
  onToggle,
  onClear,
}: {
  /** The compared options' keys. */
  active: readonly string[];
  options: CompareOption[];
  notice?: string;
  /** How many fit beside the one on stage, said in the menu when more than one. */
  limit?: number;
  onToggle: (option: CompareOption) => void;
  onClear: () => void;
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

  const clear = () => {
    setOpen(false);
    onClear();
  };

  const needle = query.trim().toLowerCase();
  const matches = (option: CompareOption) =>
    needle === "" || `${option.label} ${option.hint}`.toLowerCase().includes(needle);
  const searchLabel = options.some((option) => option.target.type === "draft")
    ? "Search drafts and versions"
    : "Search versions and paywalls";
  const drafts = options.filter((option) => option.target.type === "draft").filter(matches);
  const origins = options.filter((option) => option.target.type === "origin").filter(matches);
  const versions = options.filter((option) => option.target.type === "version").filter(matches);
  const paywalls = options.filter((option) => option.target.type === "surface").filter(matches);
  const rows = (group: CompareOption[]) =>
    group.map((option) => (
      <MenuItem
        key={option.key}
        label={option.label}
        hint={option.hint}
        selected={active.includes(option.key)}
        onSelect={() => onToggle(option)}
      />
    ));
  const groups = [
    { label: "Drafts", options: drafts },
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
        aria-pressed={active.length > 0}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ColumnsIcon />
        Compare
        {active.length > 1 && <span className="text-primary tabular-nums">{active.length}</span>}
      </button>

      {open && (
        <MenuPopup popupRef={popupRef} anchor={menuRef} side="top" align={align} className="w-72">
          <label className="flex items-center gap-2.5 border-b border-border ps-3 pe-2.5">
            <SearchIcon className="icon-tertiary" />
            <input
              className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-fg-muted"
              type="search"
              value={query}
              placeholder={searchLabel}
              aria-label={searchLabel}
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
            {limit !== undefined && limit > 1 && (
              <span className="block px-2.5 py-1.5 text-xs text-fg-tertiary">
                {`Up to ${limit + 1} side by side. A new one replaces the oldest.`}
              </span>
            )}
            <MenuItem
              label="Off"
              hint="A single preview"
              selected={active.length === 0}
              onSelect={clear}
            />
          </div>
        </MenuPopup>
      )}
    </div>
  );
};
