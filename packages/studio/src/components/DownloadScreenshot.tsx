import * as React from "react";
import { DownloadIcon, SpinnerIcon } from "./icons";
import { MenuGroupLabel, MenuItem, MenuPopup, useDismiss, usePopupAlign } from "./menus/Menu";
import { Tooltip } from "./Tooltip";
import { fetchScreenshots } from "../lib/actions";
import { notify } from "../lib/notify";
import { surfacePath } from "../lib/preview";
import { useStudioMode } from "../lib/studio-host";
import type { StudioScreenshot, StudioSource, StudioSurface } from "../lib/surfaces";

type Shot =
  | { status: "checking" }
  | { status: "ready"; shots: StudioScreenshot[] }
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

const fileName = (
  surface: StudioSurface,
  chosen: StudioScreenshot,
  index: number,
  only: boolean,
) => {
  if (only) return `${surface.id}.png`;
  const slug = chosen.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${surface.id}-${slug || `page-${index + 1}`}.png`;
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
  const [picking, setPicking] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const dismissRefs = React.useMemo(() => [menuRef, popupRef], []);
  useDismiss(dismissRefs, picking, () => setPicking(false));
  const align = usePopupAlign(menuRef, picking);

  const resolve = hosted ? source.screenshots : fetchScreenshots;

  React.useEffect(() => {
    if (resolve === undefined) {
      setShot({ status: "none" });
      return;
    }
    let cancelled = false;
    setShot({ status: "checking" });
    resolve(surface).then(
      (shots) => {
        if (cancelled) return;
        setShot(
          shots === undefined || shots.length === 0
            ? { status: "none" }
            : { status: "ready", shots },
        );
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

  const save = async (shots: StudioScreenshot[], chosen: StudioScreenshot, index: number) => {
    setPicking(false);
    setSaving(true);
    try {
      const response = await fetch(
        hosted
          ? chosen.url
          : `/__studio/screenshot${surfacePath(surface)}?download=1&page=${index}`,
      );
      if (!response.ok) {
        throw new Error(
          `${hosted ? "the image host" : "the dev server"} answered ${response.status}`,
        );
      }
      const href = URL.createObjectURL(await response.blob());
      open(href, fileName(surface, chosen, index, shots.length === 1));
      URL.revokeObjectURL(href);
    } catch (error: unknown) {
      if (hosted) {
        open(chosen.url);
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

  const press = () => {
    if (shot.status !== "ready" || saving) return;
    const [first] = shot.shots;
    if (first !== undefined && shot.shots.length === 1) {
      void save(shot.shots, first, 0);
      return;
    }
    setPicking((value) => !value);
  };

  const pages = shot.status === "ready" ? shot.shots : [];
  const blocked = shot.status !== "ready" || saving;
  const hint =
    saving || picking
      ? undefined
      : shot.status === "ready"
        ? "Download screenshot"
        : shot.status === "unreachable"
          ? shot.reason
          : HINTS[shot.status];

  return (
    <div className="relative flex" ref={menuRef}>
      <Tooltip hint={hint}>
        <button
          className="sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost"
          type="button"
          aria-label="Download screenshot"
          aria-disabled={blocked}
          aria-busy={saving || undefined}
          aria-expanded={pages.length > 1 ? picking : undefined}
          onClick={press}
        >
          {saving ? <SpinnerIcon /> : <DownloadIcon />}
        </button>
      </Tooltip>

      {picking && (
        <MenuPopup
          popupRef={popupRef}
          anchor={menuRef}
          side="bottom"
          align={align}
          className="w-64"
        >
          <div className="flex max-h-80 scroll-fade flex-col overflow-y-auto p-1" data-menu-list="">
            <MenuGroupLabel>Download a page</MenuGroupLabel>
            {pages.map((page, index) => (
              <MenuItem
                key={`${index}:${page.url}`}
                label={page.label}
                onSelect={() => void save(pages, page, index)}
              />
            ))}
          </div>
        </MenuPopup>
      )}
    </div>
  );
};
