import * as React from "react";

const DIVIDER = "data-toolbar-divider";
const ORPHAN = "data-orphan";

const midline = (item: HTMLElement) => item.offsetTop + item.offsetHeight / 2;

const sameRow = (a: HTMLElement, b: HTMLElement) =>
  Math.abs(midline(a) - midline(b)) <= Math.min(a.offsetHeight, b.offsetHeight) / 2 + 1;

export const markOrphanDividers = (toolbar: HTMLElement) => {
  const items = [...toolbar.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  items.forEach((item, index) => {
    if (!item.hasAttribute(DIVIDER)) return;
    const previous = items[index - 1];
    const next = items[index + 1];
    const startsRow = previous === undefined || !sameRow(previous, item);
    const endsRow = next === undefined || !sameRow(item, next);
    item.toggleAttribute(ORPHAN, startsRow || endsRow);
  });
};

export const Toolbar = ({ children }: React.PropsWithChildren) => {
  const [toolbar, setToolbar] = React.useState<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    if (!toolbar) return undefined;
    const mark = () => markOrphanDividers(toolbar);
    mark();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(mark);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [toolbar, children]);

  return (
    <div className="z-10 flex-none border-t border-border bg-background">
      <div
        className="flex min-h-14 items-center justify-center-safe gap-4 px-4 py-3 max-sm:scroll-fade-x max-sm:overflow-x-auto sm:flex-wrap [&>*]:flex-none"
        ref={setToolbar}
      >
        {children}
      </div>
    </div>
  );
};

export const ToolbarGroup = ({ label, children }: React.PropsWithChildren<{ label: string }>) => (
  <div className="flex items-center gap-2">
    <span className="text-xs font-medium whitespace-nowrap text-fg-tertiary">{label}</span>
    {children}
  </div>
);

export const ToolbarDivider = () => (
  <span className="h-4 w-px bg-border data-[orphan]:invisible" data-toolbar-divider="" />
);
