import * as React from "react";
import { EmptyState } from "../components/EmptyState";
import { AlertTriangleIcon, AppWindowIcon, SearchIcon } from "../components/icons";
import { InlineCode } from "../components/InlineCode";
import { OpenInApp } from "../components/OpenInApp";
import { SurfaceCard } from "../components/SurfaceCard";
import { TopBar } from "../components/chrome/TopBar";
import { type StudioSource, type StudioStatus, type StudioSurface } from "../lib/surfaces";
import { hostStateFor, studioDefaults } from "../lib/host";
import { surfacePath } from "../lib/preview";
import { useStudioMode } from "../lib/studio-host";

let lastScroll = 0;

export const SurfaceList = ({
  source,
  onOpen,
}: {
  source: StudioSource;
  onOpen: (surface: StudioSurface) => void;
}) => {
  const device = useStudioMode() === "device";
  const actions = source.actions;
  const [statuses, setStatuses] = React.useState<Record<string, StudioStatus>>({});
  const defaults = React.useMemo(studioDefaults, [source]);

  React.useEffect(() => {
    if (!actions) return;
    let cancelled = false;
    for (const surface of source.surfaces) {
      void actions.status(surface).then((status) => {
        if (cancelled) return;
        setStatuses((current) => ({ ...current, [surfacePath(surface)]: status }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [source, actions]);

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
            `${surface.project ?? ""} ${surface.id} ${surface.label ?? ""}`
              .toLowerCase()
              .includes(needle),
        ),
      };
    })
    .filter((section) => section.all.length > 0);

  const clear = (kind: string) => setQueries((current) => ({ ...current, [kind]: "" }));

  return (
    <>
      <TopBar
        label={device ? "Preview" : undefined}
        actions={
          device ? <OpenInApp origin={window.location.origin} scheme={source.scheme} /> : undefined
        }
      />

      <div className="flex-1 overflow-y-auto" ref={scroller}>
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 p-3 sm:p-6 lg:p-10">
          <header className="flex flex-col gap-0.5">
            <h1 className="m-0 text-2xl font-medium">{source.title}</h1>
            {!device && (
              <p className="m-0 text-base text-fg-secondary">
                Previews run against a real SDK host, and you choose the outcomes. Edit files under{" "}
                <InlineCode>superwall/</InlineCode> and they update live.
              </p>
            )}
          </header>

          {source.diagnostics && source.diagnostics.length > 0 && (
            <div
              className="flex gap-2 rounded-sm border border-destructive/32 bg-destructive/8 py-3 ps-[calc(--spacing(3)-1px)] pe-3 text-sm text-destructive-foreground"
              role="alert"
            >
              <span className="flex h-5 flex-none items-center">
                <AlertTriangleIcon />
              </span>
              <span className="min-w-0 whitespace-pre-wrap text-destructive-foreground/80">
                {source.diagnostics.join("\n")}
              </span>
            </div>
          )}

          {sections.map((section) => (
            <section
              key={section.kind}
              className="overflow-hidden rounded-sm border border-border bg-card"
              aria-label={section.label}
            >
              <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-2.5 ps-4 pe-2.5">
                <h2 className="m-0 flex flex-1 items-center gap-1.5 text-sm font-medium tracking-normal whitespace-nowrap">
                  {section.label}
                  <span className="font-normal text-fg-tertiary tabular-nums">
                    {section.surfaces.length}
                  </span>
                </h2>
                {section.all.length > 1 && (
                  <label className="relative flex w-full items-center sm:w-56">
                    <SearchIcon className="icon-tertiary pointer-events-none absolute left-[calc(--spacing(2.5)-1px)]" />
                    <input
                      className="sw-input sw-input--sm ps-8"
                      type="search"
                      value={queries[section.kind] ?? ""}
                      placeholder={`Search ${section.label.toLowerCase()}`}
                      aria-label={`Search ${section.label.toLowerCase()}`}
                      onChange={(event) =>
                        setQueries((current) => ({
                          ...current,
                          [section.kind]: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}
              </div>
              {section.surfaces.length > 0 ? (
                <div className="-me-px -mb-px grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {section.surfaces.map((surface) => {
                    const preview = device ? source.standaloneUrl?.(surface) : undefined;
                    return (
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
                        onOpen={() =>
                          preview === undefined ? onOpen(surface) : window.location.assign(preview)
                        }
                        href={preview ?? (device ? surfacePath(surface) : undefined)}
                      />
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={<SearchIcon />}
                  title={`No ${section.label.toLowerCase()} match “${(queries[section.kind] ?? "").trim()}”`}
                  actions={
                    <button
                      type="button"
                      className="sw-btn sw-btn--sm"
                      onClick={() => clear(section.kind)}
                    >
                      Clear search
                    </button>
                  }
                />
              )}
            </section>
          ))}

          {source.surfaces.length === 0 && (
            <div className="rounded-sm border border-border bg-card">
              <EmptyState
                icon={<AppWindowIcon />}
                title="No paywalls yet"
                description={
                  <>
                    Create <InlineCode>superwall/paywalls/&lt;id&gt;/app/page.tsx</InlineCode> and
                    it appears here.
                  </>
                }
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
};
