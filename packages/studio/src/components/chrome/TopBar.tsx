import * as React from "react";
import { useStudioHome } from "../../lib/studio-host";

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
  inset = false,
  label = "Studio",
}: {
  title: string;
  actions?: React.ReactNode;
  inset?: boolean;
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
    <header className="relative z-20 flex h-11 flex-none items-center border-b border-cream/10 bg-ink">
      <div
        className={`relative flex h-full w-full items-center px-3 ${inset ? "mx-auto max-w-[1080px] sm:px-0" : ""}`}
        ref={setBar}
      >
        <a
          className="flex items-center gap-3 text-[0.9375rem] font-semibold tracking-[0.01em]"
          href={home.href}
          onClick={(event) => {
            if (event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            home.navigate();
          }}
        >
          <span className="whitespace-nowrap">
            <em className="text-accent not-italic">$UPER</em>WALL
          </span>
          <span className="h-4 w-px bg-cream/20" />
          <span className="font-normal">{label}</span>
        </a>
        <span
          className={`absolute left-1/2 -translate-x-1/2 text-sm font-medium whitespace-nowrap ${fits ? "" : "invisible"}`}
          aria-hidden={fits ? undefined : true}
          ref={setTitleElement}
        >
          {title}
        </span>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
    </header>
  );
};
