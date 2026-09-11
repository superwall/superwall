import * as React from "react";

export const Tooltip = ({ hint, children }: { hint?: string; children: React.ReactNode }) => {
  const [shown, setShown] = React.useState(false);

  if (hint === undefined) return <>{children}</>;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
    >
      {children}
      {shown && (
        <span
          role="tooltip"
          className="bg-bar pointer-events-none absolute top-full right-0 z-50 mt-[calc(0.5rem+2px)] w-64 rounded border border-cream/10 px-3 py-2 text-left text-[0.75rem] leading-snug font-normal whitespace-normal text-cream/75"
        >
          {hint}
        </span>
      )}
    </span>
  );
};
