import * as React from "react";
import { useStudioHome } from "../../lib/studio-host";
import { ControlSizeContext } from "../controls";

const CLEARANCE = 16;

export const titleFits = (bar: HTMLElement, title: HTMLElement) => {
  const siblings = [...bar.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child !== title,
  );
  const centre = bar.clientWidth / 2;
  const half = title.scrollWidth / 2;
  return siblings.every((sibling) => {
    const start = sibling.offsetLeft;
    const end = start + sibling.offsetWidth;
    return end + CLEARANCE <= centre - half || start - CLEARANCE >= centre + half;
  });
};

export const TopBar = ({
  title,
  actions,
  label = "Studio",
}: {
  title?: string;
  actions?: React.ReactNode;
  label?: string;
}) => {
  const home = useStudioHome();
  const [bar, setBar] = React.useState<HTMLDivElement | null>(null);
  const [titleElement, setTitleElement] = React.useState<HTMLSpanElement | null>(null);
  const [fits, setFits] = React.useState(true);

  React.useLayoutEffect(() => {
    if (!bar || !titleElement) return undefined;
    const measure = () => setFits(titleFits(bar, titleElement));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    for (const child of bar.children) observer.observe(child);
    return () => observer.disconnect();
  }, [bar, titleElement, title, actions]);

  return (
    <header className="relative z-20 flex h-12 flex-none items-center border-b border-border bg-background">
      <div className="relative flex h-full w-full items-center ps-4 pe-2.5" ref={setBar}>
        <a
          className="relative flex items-center gap-4 text-sm before:pointer-events-none before:absolute before:-inset-x-1 before:-inset-y-0.5 before:rounded-sm before:border before:border-transparent before:transition-colors before:duration-hover focus-visible:before:border-primary"
          href={home.href}
          onClick={(event) => {
            if (event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            home.navigate();
          }}
        >
          <span className="font-semibold whitespace-nowrap">
            <span className="text-primary">$UPER</span>WALL
          </span>
          <span className="h-4 w-px bg-border max-sm:hidden" />
          <span className="text-fg-secondary max-sm:hidden">{label}</span>
        </a>
        {title !== undefined && (
          <span
            className={`absolute left-1/2 -translate-x-1/2 text-sm font-medium whitespace-nowrap ${fits ? "" : "invisible"}`}
            aria-hidden={fits ? undefined : true}
            ref={setTitleElement}
          >
            {title}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ControlSizeContext.Provider value="sm">{actions}</ControlSizeContext.Provider>
        </div>
      </div>
    </header>
  );
};
