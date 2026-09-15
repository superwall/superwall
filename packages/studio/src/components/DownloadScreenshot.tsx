import * as React from "react";
import { SpinnerIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import { fetchScreenshot } from "../lib/actions";
import { notify } from "../lib/notify";
import { surfacePath } from "../lib/preview";
import { useStudioMode } from "../lib/studio-host";
import type { StudioSource, StudioSurface } from "../lib/surfaces";

type Shot =
  | { status: "checking" }
  | { status: "ready"; url: string }
  | { status: "none" }
  | { status: "unreachable"; reason: string };

const HINTS: Record<Exclude<Shot["status"], "ready">, string> = {
  checking: "Looking for a screenshot…",
  none: "This paywall has no live version yet. Screenshots are captured from the published document, so promote a pushed version before downloading one.",
  unreachable: "Couldn't reach the screenshot service.",
};

const open = (href: string, download?: string) => {
  const anchor = document.createElement("a");
  anchor.href = href;
  if (download === undefined) {
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
  } else {
    anchor.download = download;
  }
  anchor.click();
};

export const DownloadScreenshot = ({
  source,
  surface,
}: {
  source: StudioSource;
  surface: StudioSurface;
}) => {
  const hosted = useStudioMode() === "hosted";
  const [shot, setShot] = React.useState<Shot>({ status: "checking" });
  const [saving, setSaving] = React.useState(false);

  const resolve = hosted ? source.screenshotUrl : fetchScreenshot;

  React.useEffect(() => {
    if (resolve === undefined) {
      setShot({ status: "none" });
      return;
    }
    let cancelled = false;
    setShot({ status: "checking" });
    resolve(surface).then(
      (url) => {
        if (cancelled) return;
        setShot(url === undefined ? { status: "none" } : { status: "ready", url });
      },
      (error: unknown) => {
        if (cancelled) return;
        setShot({
          status: "unreachable",
          reason: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [resolve, surface]);

  const save = async () => {
    if (shot.status !== "ready" || saving) return;

    setSaving(true);
    try {
      const response = await fetch(
        hosted ? shot.url : `/__studio/screenshot${surfacePath(surface)}?download=1`,
      );
      if (!response.ok) {
        throw new Error(
          `${hosted ? "the image host" : "the dev server"} answered ${response.status}`,
        );
      }
      const href = URL.createObjectURL(await response.blob());
      open(href, `${surface.id}.png`);
      URL.revokeObjectURL(href);
    } catch (error: unknown) {
      if (hosted) {
        open(shot.url);
        notify("Opened the screenshot in a new tab — save it from there.");
      } else {
        notify(
          `Couldn't download the screenshot — ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const blocked = shot.status !== "ready" || saving;
  const hint =
    saving || shot.status === "ready"
      ? undefined
      : shot.status === "unreachable"
        ? shot.reason
        : HINTS[shot.status];

  return (
    <Tooltip hint={hint}>
      <button
        className={`sw-btn sw-btn--icon${blocked ? " sw-btn--blocked" : ""}`}
        type="button"
        aria-label="Download screenshot"
        aria-disabled={blocked}
        aria-busy={saving || undefined}
        onClick={() => void save()}
      >
        {saving ? (
          <SpinnerIcon />
        ) : (
          <svg className="sw-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
        )}
      </button>
    </Tooltip>
  );
};
