import * as React from "react";
import { OpenInApp } from "../components/OpenInApp";
import { SurfaceCard } from "../components/SurfaceCard";
import { TopBar } from "../components/TopBar";
import { fetchStatus } from "../lib/actions";
import type { StudioSource, StudioStatus, StudioSurface } from "../lib/types";
import { hostStateFor, studioDefaults } from "../lib/host";
import { surfacePath } from "../lib/preview";

let lastScroll = 0;

export const SurfaceList = ({
  source,
  onOpen,
  device = false,
}: {
  source: StudioSource;
  onOpen: (surface: StudioSurface) => void;
  device?: boolean;
}) => {
  const [statuses, setStatuses] = React.useState<Record<string, StudioStatus>>({});
  const defaults = React.useMemo(studioDefaults, [source]);

  React.useEffect(() => {
    if (source.capabilities?.actions !== true) return;
    let cancelled = false;
    for (const surface of source.surfaces) {
      void fetchStatus(surface).then((status) => {
        if (cancelled) return;
        setStatuses((current) => ({ ...current, [surfacePath(surface)]: status }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [source]);

  const [queries, setQueries] = React.useState<Record<string, string>>({});
  const scroller = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return undefined;
    element.scrollTop = lastScroll;
    const remember = () => {
      lastScroll = element.scrollTop;
    };
    element.addEventListener("scroll", remember, { passive: true });
    return () => {
      remember();
      element.removeEventListener("scroll", remember);
    };
  }, []);

  const sections = (
    [
      ["Paywalls", "paywall"],
      ["Funnels", "funnel"],
    ] as const
  )
    .map(([sectionLabel, kind]) => {
      const all = source.surfaces.filter((surface) => surface.kind === kind);
      const needle = (queries[kind] ?? "").trim().toLowerCase();
      return {
        label: sectionLabel,
        kind,
        all,
        needle,
        surfaces: all.filter(
          (surface) =>
            needle === "" ||
            `${surface.project ?? ""} ${surface.id}`.toLowerCase().includes(needle),
        ),
      };
    })
    .filter((section) => section.all.length > 0);

  return (
    <>
      <TopBar
        title={source.title}
        onHome={() => {}}
        inset
        label={device ? "Preview" : undefined}
        actions={
          device ? <OpenInApp origin={window.location.origin} scheme={source.scheme} /> : undefined
        }
      />

      <div className="flex-1 overflow-y-auto px-3 pt-6 pb-16 sm:px-6 sm:pt-10" ref={scroller}>
        <div className="mx-auto max-w-[1080px]">
          {source.diagnostics && source.diagnostics.length > 0 && (
            <div className="border-red bg-red/10 mb-6 border-l-2 px-4 py-3 text-[0.8125rem] whitespace-pre-wrap">
              {source.diagnostics.join("\n")}
            </div>
          )}

          {sections.map((section) => (
            <section key={section.kind} className="mt-10 first:mt-0">
              <div className="mb-4 flex items-center gap-2">
                <span className="text-[1.0625rem] font-medium">{section.label}</span>
                <span className="text-[0.8125rem] text-cream/55 tabular-nums">
                  {section.surfaces.length}
                </span>
                {section.all.length > 1 && (
                  <input
                    className="sw-input ml-auto w-48"
                    type="search"
                    value={queries[section.kind] ?? ""}
                    placeholder={`Search ${section.label.toLowerCase()}`}
                    aria-label={`Search ${section.label.toLowerCase()}`}
                    onChange={(event) =>
                      setQueries((current) => ({ ...current, [section.kind]: event.target.value }))
                    }
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] sm:gap-6">
                {section.surfaces.map((surface) => (
                  <SurfaceCard
                    key={surfacePath(surface)}
                    surface={surface}
                    status={statuses[surfacePath(surface)]}
                    previewSrc={source.previewUrl(surface)}
                    hostState={hostStateFor({
                      surface,
                      defaults,
                      sourceSamples: source.samples,
                      samples: {},
                      theme: "light",
                      edited: {},
                    })}
                    onOpen={() => onOpen(surface)}
                    href={device ? surfacePath(surface) : undefined}
                  />
                ))}
              </div>
              {section.surfaces.length === 0 && (
                <span className="block text-[0.8125rem] text-cream/45">
                  {`Nothing matches “${(queries[section.kind] ?? "").trim()}”.`}
                </span>
              )}
            </section>
          ))}

          {source.surfaces.length === 0 && (
            <div className="border border-dashed border-cream/20 p-12 text-center text-cream/55">
              No paywalls yet — create{" "}
              <code className="font-mono text-[0.8125rem] text-cream">
                superwall/paywalls/&lt;id&gt;/app/page.tsx
              </code>{" "}
              and it appears here.
            </div>
          )}
        </div>
      </div>

      {!device && (
        <footer className="bg-bar flex h-11 flex-none items-center justify-center border-t border-cream/10 text-xs text-cream/55">
          Previews run against the simulated SDK host. Edit files under superwall/ and they update
          live.
        </footer>
      )}
    </>
  );
};
