import * as React from "react";

const PLACEMENT: Record<"top" | "bottom", Record<"start" | "center" | "end", string>> = {
  bottom: {
    start: "top-full left-0 mt-1 origin-top-left",
    center: "top-full left-1/2 mt-1 -translate-x-1/2 origin-top",
    end: "top-full right-0 mt-1 origin-top-right",
  },
  top: {
    start: "bottom-full left-0 mb-1 origin-bottom-left",
    center: "bottom-full left-1/2 mb-1 -translate-x-1/2 origin-bottom",
    end: "bottom-full right-0 mb-1 origin-bottom-right",
  },
};

export const Tooltip = ({
  hint,
  side = "bottom",
  align = "end",
  children,
}: {
  hint?: string;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  children: React.ReactNode;
}) => {
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
          className={`pointer-events-none absolute z-50 w-max max-w-64 rounded-sm border border-border bg-popover px-2 py-1 text-left text-xs font-normal text-balance whitespace-normal text-foreground transition-[opacity,scale] duration-popup ease-out starting:scale-98 starting:opacity-0 ${PLACEMENT[side][align]}`}
        >
          {hint}
        </span>
      )}
    </span>
  );
};
