import * as React from "react";

export const EmptyState = ({
  icon,
  title,
  description,
  actions,
  tone = "muted",
  size = "default",
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: "muted" | "destructive";
  size?: "default" | "lg";
}) => (
  <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
    <span
      className={`flex flex-none items-center justify-center rounded-sm ${
        size === "lg" ? "size-14 [&>svg]:size-6" : "size-10 [&>svg]:size-4.5"
      } ${tone === "destructive" ? "bg-destructive/16 text-destructive-foreground" : "bg-muted [&>svg]:icon-tertiary"}`}
    >
      {icon}
    </span>
    <div className="flex max-w-md flex-col gap-0.5">
      <h2 className={`m-0 font-medium ${size === "lg" ? "text-lg" : "text-base"}`}>{title}</h2>
      {description !== undefined && <p className="m-0 text-sm text-fg-secondary">{description}</p>}
    </div>
    {actions !== undefined && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
  </div>
);
