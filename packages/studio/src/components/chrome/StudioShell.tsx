import * as React from "react";

export const StudioShell = ({
  children,
  position = "fixed",
}: React.PropsWithChildren<{ position?: "fixed" | "absolute" }>) => (
  <div
    className={`sw-studio bg-ink text-cream ${position} inset-0 flex flex-col font-sans text-[0.9375rem] tracking-[-0.01em] antialiased`}
  >
    {children}
  </div>
);
