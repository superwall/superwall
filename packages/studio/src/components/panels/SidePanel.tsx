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

/**
 * The host's panel at the start of the stage row (a chat beside the paywall),
 * between the top bar and the toolbar. It opens the way the Variables panel
 * does, by growing its width, while its content keeps its own width pinned to
 * the panel's inner edge, so the content slides in from the left and the
 * canvas re-fits beside it; on a row narrower than a phone in landscape it
 * takes the whole row. It has no header: the host draws its own.
 */
export const HostPanel = ({
  open,
  label,
  children,
}: React.PropsWithChildren<{ open: boolean; label: string }>) => (
  <aside
    className={`relative flex-none overflow-hidden transition-[width] duration-move ease-drawer motion-reduce:transition-none ${
      open ? "w-[min(23rem,100cqw)] @max-xl:w-[100cqw]" : "w-0"
    }`}
    aria-label={label}
    aria-hidden={!open}
    inert={!open}
    data-testid="host-panel"
  >
    <div className="absolute inset-y-0 end-0 w-[min(23rem,100cqw)] border-r border-border bg-background @max-xl:w-[100cqw]">
      {children}
    </div>
  </aside>
);
