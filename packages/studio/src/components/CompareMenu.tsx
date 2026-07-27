import * as React from "react";
import { ColumnsIcon } from "./icons";
import type { CompareTarget } from "../lib/types";

export type CompareOption = {
  key: string;
  label: string;
  hint: string;
  target: CompareTarget;
};

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
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const activeKey =
    active &&
    (active.type === "live" ? "live" : `surface:${active.surface.kind}/${active.surface.id}`);

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
        <div className="bg-bar absolute bottom-full left-0 z-20 mb-1 w-64 border border-cream/20">
          {active && (
            <button
              type="button"
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-cream/5"
              onClick={() => {
                setOpen(false);
                onSelect(undefined);
              }}
            >
              <span className="text-[0.8125rem] font-medium">Off</span>
              <span className="text-xs text-cream/55">Back to a single preview</span>
            </button>
          )}
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-cream/5"
              onClick={() => {
                setOpen(false);
                onSelect(option.target);
              }}
            >
              <span className="text-[0.8125rem] font-medium">
                {option.label}
                {option.key === activeKey && <span className="text-accent"> ·</span>}
              </span>
              <span className="text-xs text-cream/55">{option.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
