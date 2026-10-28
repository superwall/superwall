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

const rowCount = (toolbar: HTMLElement) => {
  let rows = 0;
  let last: HTMLElement | undefined;
  for (const child of toolbar.children) {
    if (!(child instanceof HTMLElement) || child.hasAttribute(DIVIDER)) continue;
    if (!last || !sameRow(last, child)) rows += 1;
    last = child;
  }
  return rows;
};

/**
 * Narrows a wrapping toolbar to the least width that still fits in as many
 * rows as it needs, so its items spread evenly over those rows instead of
 * filling the first and leaving one alone on the last: `text-wrap: balance`
 * for controls.
 */
export const balanceRows = (toolbar: HTMLElement) => {
  toolbar.style.maxWidth = "";
  if (getComputedStyle(toolbar).flexWrap !== "wrap") return;
  const rows = rowCount(toolbar);
  if (rows < 2) return;
  let fits = toolbar.offsetWidth;
  let tooNarrow = 0;
  while (fits - tooNarrow > 4) {
    const width = Math.floor((fits + tooNarrow) / 2);
    toolbar.style.maxWidth = `${width}px`;
    if (rowCount(toolbar) > rows) tooNarrow = width;
    else fits = width;
  }
  toolbar.style.maxWidth = `${fits}px`;
};

export const Toolbar = ({ children }: React.PropsWithChildren) => {
  const [frame, setFrame] = React.useState<HTMLDivElement | null>(null);
  const toolbar = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const items = toolbar.current;
    if (!frame || !items) return undefined;
    const layout = () => {
      balanceRows(items);
      markOrphanDividers(items);
    };
    layout();
    if (typeof ResizeObserver === "undefined") return undefined;
    // The frame, not the row: balancing resizes the row, which would re-fire.
    const observer = new ResizeObserver(layout);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame, children]);

  return (
    <div className="z-10 flex-none border-t border-border bg-background" ref={setFrame}>
      <div
        className="mx-auto flex min-h-14 items-center justify-center-safe gap-4 px-4 py-3 max-sm:scroll-fade-x max-sm:overflow-x-auto sm:flex-wrap [&>*]:flex-none"
        ref={toolbar}
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
