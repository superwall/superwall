import * as React from "react";
import type { StudioUpdate } from "../lib/contract";
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  ExternalIcon,
  InfoCircleIcon,
  XIcon,
} from "./icons";

const STORAGE_KEY = "superwall-dismissed-update";

const readDismissed = (): string | undefined => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

const storeDismissed = (version: string) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, version);
  } catch {
    return;
  }
};

const CopyCommand = ({ command }: { command: string }) => {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-xs border border-border bg-muted px-1.5 py-px font-mono text-xs text-foreground"
      aria-label={copied ? `Copied ${command}` : `Copy ${command}`}
      onClick={() => {
        navigator.clipboard?.writeText(command).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      <span className="truncate">{command}</span>
      {copied ? (
        <CheckIcon className="size-3 shrink-0 text-success" />
      ) : (
        <CopyIcon className="size-3 shrink-0" />
      )}
    </button>
  );
};

export const UpdateBanner = ({ update }: { update: StudioUpdate | undefined }) => {
  const [dismissed, setDismissed] = React.useState(readDismissed);
  if (update === undefined || dismissed === update.latest) return null;
  const major = update.kind === "major";

  return (
    <div
      role="status"
      className={`flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-sm ${
        major ? "border-warning/40 bg-warning/12" : "border-border bg-muted/60"
      }`}
    >
      <span
        className={`flex flex-none [&>svg]:size-4 ${major ? "text-warning-foreground" : "text-fg-tertiary"}`}
      >
        {major ? <AlertTriangleIcon /> : <InfoCircleIcon />}
      </span>
      <span className="min-w-0">
        <span className="font-medium">{major ? "Major update available" : "Update available"}</span>{" "}
        <span className="text-fg-secondary">
          superwall {update.current} → {update.latest}
          {major ? " · it may contain breaking changes." : ""}
        </span>
      </span>
      {major && (
        <a
          href={update.notes}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-foreground underline underline-offset-2 [&>svg]:size-3"
        >
          Release notes
          <ExternalIcon />
        </a>
      )}
      <span className="flex min-w-0 items-center gap-1.5 text-fg-secondary">
        Run <CopyCommand command={update.command} />
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        className="sw-btn sw-btn--xs sw-btn--icon sw-btn--ghost ml-auto"
        onClick={() => {
          storeDismissed(update.latest);
          setDismissed(update.latest);
        }}
      >
        <XIcon />
      </button>
    </div>
  );
};
