import * as React from "react";

const DIVIDER = "data-toolbar-divider";
const ORPHAN = "data-orphan";

const midline = (item: HTMLElement) => item.offsetTop + item.offsetHeight / 2;

const sameRow = (a: HTMLElement, b: HTMLElement) =>
  Math.abs(midline(a) - midline(b)) <= Math.min(a.offsetHeight, b.offsetHeight) / 2 + 1;

export const markOrphanDividers = (toolbar: HTMLElement) => {
  const items = [...toolbar.children].filter((child): child is HTMLElement =>
    child instanceof HTMLElement,
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
    <div
      className="bg-bar z-10 flex min-h-14 flex-none flex-wrap items-center justify-center gap-3 border-t border-cream/10 px-4 py-2.5"
      ref={setToolbar}
    >
      {children}
    </div>
  );
};

export const ToolbarGroup = ({ label, children }: React.PropsWithChildren<{ label: string }>) => (
  <div className="flex items-center gap-2.5">
    <span className="sw-tool-label">{label}</span>
    {children}
  </div>
);

export const ToolbarDivider = () => (
  <span className="h-6 w-px bg-cream/10 data-[orphan]:invisible" data-toolbar-divider="" />
);
