import * as React from "react";
import { DownloadIcon, SpinnerIcon } from "./icons";
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
  unreachable: "Couldn’t reach the screenshot service.",
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
  autoDownload = false,
}: {
  source: StudioSource;
  surface: StudioSurface;
  /** Downloads once the screenshot is known, as a save made for it lands here. */
  autoDownload?: boolean;
}) => {
  const hosted = useStudioMode() === "hosted";
  const [shot, setShot] = React.useState<Shot>({ status: "checking" });
  const [saving, setSaving] = React.useState(false);
  const pending = React.useRef(autoDownload);
  const unsaved = source.unsaved;

  const resolve = unsaved ? undefined : hosted ? source.screenshotUrl : fetchScreenshot;

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
        notify("Opened the screenshot in a new tab", { description: "Save it from there." });
      } else {
        notify("Couldn’t download screenshot", {
          tone: "warning",
          description: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  React.useEffect(() => {
    if (!pending.current || shot.status === "checking") return;
    pending.current = false;
    if (shot.status === "ready") void save();
    else
      notify("Couldn’t download screenshot", {
        tone: "warning",
        description: shot.status === "none" ? HINTS.none : shot.reason,
      });
  }, [shot]);

  if (unsaved) {
    const savingFirst = unsaved.saving === "screenshot";
    return (
      <Tooltip hint={savingFirst ? undefined : "Save this paywall, then download its screenshot"}>
        <button
          className="sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost"
          type="button"
          aria-label={savingFirst ? "Saving…" : "Download screenshot"}
          disabled={unsaved.saving !== undefined}
          aria-busy={savingFirst || undefined}
          onClick={() => unsaved.save("screenshot")}
        >
          {savingFirst ? <SpinnerIcon /> : <DownloadIcon />}
        </button>
      </Tooltip>
    );
  }

  const blocked = shot.status !== "ready" || saving;
  const hint = saving
    ? undefined
    : shot.status === "ready"
      ? "Download screenshot"
      : shot.status === "unreachable"
        ? shot.reason
        : HINTS[shot.status];

  return (
    <Tooltip hint={hint}>
      <button
        className="sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost"
        type="button"
        aria-label="Download screenshot"
        aria-disabled={blocked}
        aria-busy={saving || undefined}
        onClick={() => void save()}
      >
        {saving ? <SpinnerIcon /> : <DownloadIcon />}
      </button>
    </Tooltip>
  );
};
