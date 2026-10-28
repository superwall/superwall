import * as React from "react";
import { XIcon } from "./icons";

export const Dialog = ({
  title,
  description,
  footer,
  onClose,
  children,
}: React.PropsWithChildren<{
  title: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
}>) => {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const popup = React.useRef<HTMLDivElement>(null);
  const close = React.useRef(onClose);
  close.current = onClose;

  React.useEffect(() => {
    popup.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid grid-rows-[1fr_auto_3fr] justify-items-center bg-scrim p-4 transition-opacity duration-dialog ease-out starting:opacity-0 max-sm:grid-rows-[1fr_auto] max-sm:p-0"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={popup}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        tabIndex={-1}
        className="relative row-start-2 flex w-full max-w-lg flex-col rounded-sm border border-border bg-popover text-foreground outline-none transition-[opacity,scale] duration-dialog ease-out starting:scale-98 starting:opacity-0 max-sm:max-w-none max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0"
      >
        <div className="flex flex-col gap-1 p-5 pe-14 pb-3">
          <h2 id={titleId} className="m-0 text-lg font-medium">
            {title}
          </h2>
          {description !== undefined && (
            <p id={descriptionId} className="m-0 text-sm text-fg-secondary">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          className="sw-btn sw-btn--icon sw-btn--ghost absolute top-[calc(--spacing(3.5)-1px)] right-[calc(--spacing(3.5)-1px)]"
          aria-label="Close"
          onClick={onClose}
        >
          <XIcon />
        </button>
        {children === undefined ? (
          <div className="pb-2" />
        ) : (
          <div className="flex flex-col gap-4 px-5 pt-1 pb-5">{children}</div>
        )}
        {footer !== undefined && (
          <div className="flex flex-col-reverse gap-2 rounded-b-[calc(var(--radius-2xl)-1px)] border-t border-border bg-card px-5 py-3 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
