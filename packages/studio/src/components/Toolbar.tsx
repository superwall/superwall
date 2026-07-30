import * as React from "react";

export const Toolbar = ({ children }: React.PropsWithChildren) => (
  <div className="bg-bar z-10 flex min-h-14 flex-none flex-wrap items-center justify-center gap-3 border-t border-cream/10 px-4 py-2.5">
    {children}
  </div>
);

export const ToolbarGroup = ({ label, children }: React.PropsWithChildren<{ label: string }>) => (
  <div className="flex items-center gap-2.5">
    <span className="sw-tool-label">{label}</span>
    {children}
  </div>
);

export const ToolbarDivider = () => <span className="h-6 w-px bg-cream/10" />;
