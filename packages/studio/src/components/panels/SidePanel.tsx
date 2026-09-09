import * as React from "react";
import { CloseIcon } from "../icons";

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
    className={`flex-none overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none ${
      open ? "w-72" : "w-0"
    }`}
    aria-hidden={!open}
    inert={!open}
  >
    <div className="bg-bar flex h-full w-72 flex-col border-l border-cream/10">
      <div className="flex h-11 flex-none items-center justify-between border-b border-cream/10 px-3">
        <span className="text-[0.8125rem] font-medium text-cream">{title}</span>
        <button
          type="button"
          className="sw-btn sw-btn--icon border-transparent"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">{children}</div>
    </div>
  </aside>
);
