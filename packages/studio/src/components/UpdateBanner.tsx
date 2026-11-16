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

const RELEASES_URL = "https://github.com/superwall/superwall/releases";

export const updatePrompt = (update: StudioUpdate): string =>
  update.kind === "major"
    ? [
        `Upgrade this project's superwall from ${update.current} to ${update.latest}. It is a major release, so it may contain breaking changes.`,
        "",
        `1. Read the release notes of ${update.latest} (${update.notes}) and of every release between ${update.current} and ${update.latest} (${RELEASES_URL}).`,
        "2. List each breaking change that touches this project: search its paywalls, components and config for every API that was changed or removed. Before you change anything, tell me what will break and ask me about any change that needs a decision.",
        `3. Run \`${update.command}\`.`,
        "4. Make the changes the breaking changes require, then run `superwall build` and check in `superwall dev` that every paywall still builds and looks the same.",
      ].join("\n")
    : [
        `Upgrade this project's superwall from ${update.current} to ${update.latest}.`,
        "",
        `1. Read the release notes (${update.notes}) and tell me if anything in them touches this project.`,
        `2. Run \`${update.command}\`.`,
        "3. Run `superwall build` and check that every paywall still builds.",
      ].join("\n");

const CopyPrompt = ({ update, warning }: { update: StudioUpdate; warning: boolean }) => {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={`inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-xs border px-1.5 py-px font-mono text-xs ${
        warning
          ? "border-warning/30 bg-warning/10 text-warning-foreground hover:bg-warning/18"
          : "border-border bg-muted text-foreground hover:bg-muted/70"
      }`}
      title={update.command}
      onClick={() => {
        navigator.clipboard?.writeText(updatePrompt(update)).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? "Copied" : "Copy prompt"}
      {copied ? (
        <CheckIcon className={`size-3 shrink-0 ${warning ? "" : "text-success"}`} />
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
      className={`relative z-10 flex flex-none flex-wrap items-center gap-x-2 gap-y-1 border-b border-border py-1.5 ps-4 pe-2.5 text-sm ${
        major ? "bg-warning/8 text-warning-foreground" : "text-fg-secondary"
      }`}
    >
      <span className={`flex flex-none [&>svg]:size-4 ${major ? "" : "text-fg-tertiary"}`}>
        {major ? <AlertTriangleIcon /> : <InfoCircleIcon />}
      </span>
      <span className="min-w-0">
        <span className={major ? "" : "text-foreground"}>
          {major ? "Major update available" : "Update available"}
        </span>{" "}
        <span className={major ? "text-warning-foreground/80" : ""}>
          · superwall {update.current} → {update.latest}
          {major ? ", it may contain breaking changes" : ""}
        </span>
      </span>
      {major && (
        <a
          href={update.notes}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2 [&>svg]:size-3"
        >
          Release notes
          <ExternalIcon />
        </a>
      )}
      <span className="ml-auto flex flex-none items-center gap-2">
        <CopyPrompt update={update} warning={major} />
        <button
          type="button"
          aria-label="Dismiss"
          className={`sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost ${
            major ? "[&>.sw-icon]:text-warning-foreground [&>.sw-icon]:[filter:none]" : ""
          }`}
          onClick={() => {
            storeDismissed(update.latest);
            setDismissed(update.latest);
          }}
        >
          <XIcon />
        </button>
      </span>
    </div>
  );
};
