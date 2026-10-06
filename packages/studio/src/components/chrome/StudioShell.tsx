import * as React from "react";

export const StudioShell = ({
  children,
  position = "fixed",
}: React.PropsWithChildren<{ position?: "fixed" | "absolute" }>) => (
  <div
    className={`sw-studio bg-background text-foreground ${position} inset-0 flex flex-col font-sans text-base antialiased`}
  >
    {children}
  </div>
);
