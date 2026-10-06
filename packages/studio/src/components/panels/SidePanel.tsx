import * as React from "react";
import { XIcon } from "../icons";

export const SidePanel = ({
  open,
  title,
  onClose,
  children,
}: React.PropsWithChildren<{
  open: boolean;
  title: string;
  onClose: () => void;
}>) => (
  <aside
    className={`flex-none overflow-hidden transition-[width] duration-move ease-out motion-reduce:transition-none ${
      open ? "w-80" : "w-0"
    }`}
    aria-hidden={!open}
    inert={!open}
  >
    <div className="flex h-full w-80 flex-col border-l border-border bg-background">
      <div className="flex h-12 flex-none items-center justify-between border-b border-border ps-4 pe-2.5">
        <span className="text-sm font-medium">{title}</span>
        <button
          type="button"
          className="sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      <div className="min-h-0 flex-1 scroll-fade overflow-y-auto">{children}</div>
    </div>
  </aside>
);
