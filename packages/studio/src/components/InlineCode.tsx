import * as React from "react";

export const InlineCode = ({ children }: React.PropsWithChildren) => (
  <code className="rounded-xs border border-border bg-muted px-1 py-px font-mono text-xs font-normal wrap-anywhere text-foreground">
    {children}
  </code>
);
