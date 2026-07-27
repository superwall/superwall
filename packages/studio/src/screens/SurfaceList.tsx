import * as React from "react";
import { SurfaceCard } from "../components/SurfaceCard";
import { TopBar } from "../components/TopBar";
import { fetchStatus } from "../lib/actions";
import type { StudioSource, StudioStatus, StudioSurface } from "../lib/types";

export const SurfaceList = ({
  source,
  onOpen,
}: {
  source: StudioSource;
  onOpen: (surface: StudioSurface) => void;
}) => {
  const [statuses, setStatuses] = React.useState<Record<string, StudioStatus>>({});

  React.useEffect(() => {
    if (source.capabilities?.actions !== true) return;
    let cancelled = false;
    for (const surface of source.surfaces) {
      void fetchStatus(surface).then((status) => {
        if (cancelled) return;
        setStatuses((current) => ({ ...current, [`${surface.kind}/${surface.id}`]: status }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [source]);

  const sections = (
    [
      ["Paywalls", "paywall"],
      ["Funnels", "funnel"],
    ] as const
  )
    .map(([label, kind]) => ({
      label,
      kind,
      surfaces: source.surfaces.filter((surface) => surface.kind === kind),
    }))
    .filter((section) => section.surfaces.length > 0);

  return (
    <>
      <TopBar title={source.title} onHome={() => {}} />

      <div className="flex-1 overflow-y-auto px-6 pt-10 pb-16">
        <div className="mx-auto max-w-[1080px]">
          {source.diagnostics && source.diagnostics.length > 0 && (
            <div className="border-red bg-red/10 mb-6 border-l-2 px-4 py-3 text-[0.8125rem] whitespace-pre-wrap">
              {source.diagnostics.join("\n")}
            </div>
          )}

          {sections.map((section) => (
            <section key={section.kind} className="mt-10 first:mt-0">
              <div className="mb-4 flex items-baseline gap-2">
                <span className="text-sm font-medium">{section.label}</span>
                <span className="text-xs text-cream/55 tabular-nums">
                  {section.surfaces.length}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-6">
                {section.surfaces.map((surface) => (
                  <SurfaceCard
                    key={surface.id}
                    surface={surface}
                    status={statuses[`${surface.kind}/${surface.id}`]}
                    previewSrc={source.previewUrl(surface, {})}
                    onOpen={() => onOpen(surface)}
                  />
                ))}
              </div>
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

      <footer className="bg-bar flex h-11 flex-none items-center justify-center border-t border-cream/10 text-xs text-cream/55">
        Previews run against the simulated SDK host. Edit files under superwall/ and they update
        live.
      </footer>
    </>
  );
};
