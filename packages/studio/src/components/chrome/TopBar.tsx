import * as React from "react";

export const TopBar = ({
  title,
  onHome,
  actions,
  inset = false,
  label = "Studio",
}: {
  title: string;
  onHome: () => void;
  actions?: React.ReactNode;
  inset?: boolean;
  label?: string;
}) => (
  <header className="relative z-10 flex h-11 flex-none items-center border-b border-cream/10 bg-ink">
    <div
      className={`flex h-full w-full items-center px-3 ${inset ? "mx-auto max-w-[1080px] sm:px-0" : ""}`}
    >
      <a
        className="flex items-center gap-3 text-[0.9375rem] font-semibold tracking-[0.01em]"
        href="/"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          onHome();
        }}
      >
        <span className="whitespace-nowrap">
          <em className="text-accent not-italic">$UPER</em>WALL
        </span>
        <span className="h-4 w-px bg-cream/20" />
        <span className="font-normal">{label}</span>
      </a>
      <span className="absolute left-1/2 hidden -translate-x-1/2 text-sm font-medium whitespace-nowrap sm:block">
        {title}
      </span>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  </header>
);
