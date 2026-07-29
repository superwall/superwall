import * as React from "react";
import { ActionMenu, type ActionProgress } from "../components/ActionMenu";
import { CompareMenu, type CompareOption } from "../components/CompareMenu";
import { DeviceFrame, DevicePlaceholder } from "../components/DeviceFrame";
import { Segmented, Select } from "../components/controls";
import { ExternalIcon, MoonIcon, RotateIcon, SlidersIcon, SunIcon } from "../components/icons";
import { SidePanel } from "../components/SidePanel";
import { Toolbar, ToolbarDivider, ToolbarGroup } from "../components/Toolbar";
import { TopBar } from "../components/TopBar";
import { VariablesPanel } from "../components/VariablesPanel";
import { fetchStatus, runAction } from "../lib/actions";
import {
  DEFAULT_DEVICE_ID,
  deviceById,
  RESPONSIVE_DEFAULT,
  RESPONSIVE_ID,
  STUDIO_DEVICES,
} from "../lib/devices";
import { withOverrides } from "../lib/preview";
import {
  ACTION_STEPS,
  type CompareTarget,
  type PreviewOverrides,
  type StudioActionName,
  type StudioActionStep,
  type StudioSource,
  type StudioStatus,
  type StudioStepState,
  type StudioSurface,
} from "../lib/types";

const clampSize = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(3000, Math.max(200, Math.round(value))) : fallback;

const SizeInput = ({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) => {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = clampSize(Number(draft), value);
    setDraft(String(next));
    onCommit(next);
  };

  return (
    <input
      className="sw-input w-16 text-center"
      type="number"
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
    />
  );
};

const StagePane = ({
  label,
  width,
  height,
  title,
  src,
  reloadKey,
}: {
  label?: string;
  width: number;
  height: number;
  title: string;
  src?: string;
  reloadKey: number;
}) => {
  const paneRef = React.useRef<HTMLDivElement>(null);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center" ref={paneRef}>
      <div className="flex flex-col gap-2">
        {label && <span className="text-xs text-cream/55">{label}</span>}
        {src ? (
          <DeviceFrame
            width={width}
            height={height}
            title={title}
            src={src}
            stageRef={paneRef}
            reloadKey={reloadKey}
          />
        ) : (
          <DevicePlaceholder width={width} height={height} stageRef={paneRef}>
            Nothing live yet — publish to compare against production.
          </DevicePlaceholder>
        )}
      </div>
    </div>
  );
};

export const SurfaceEditor = ({
  source,
  surface,
  onBack,
}: {
  source: StudioSource;
  surface: StudioSurface;
  onBack: () => void;
}) => {
  const [deviceId, setDeviceId] = React.useState(DEFAULT_DEVICE_ID);
  const [size, setSize] = React.useState(RESPONSIVE_DEFAULT);
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  const [locale, setLocale] = React.useState<string | undefined>(undefined);
  const [variables, setVariables] = React.useState<Record<string, unknown>>({});
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [compareWith, setCompareWith] = React.useState<CompareTarget | undefined>(undefined);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [status, setStatus] = React.useState<StudioStatus>({});
  const [progress, setProgress] = React.useState<ActionProgress | undefined>(undefined);
  const dismissTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(dismissTimer.current), []);

  const actionsEnabled = source.capabilities?.actions === true;

  React.useEffect(() => {
    if (!actionsEnabled) return;
    let cancelled = false;
    fetchStatus(surface).then((value) => {
      if (!cancelled) setStatus(value);
    });
    return () => {
      cancelled = true;
    };
  }, [actionsEnabled, surface]);

  const ship = async (action: StudioActionName) => {
    window.clearTimeout(dismissTimer.current);
    setProgress({ action, steps: {} });

    const result = await runAction(surface, action, (step, state) => {
      setProgress((current) =>
        current?.action === action
          ? {
              ...current,
              steps: { ...current.steps, [step]: state === "start" ? "active" : "done" },
            }
          : current,
      );
    });

    if (result.ok) {
      const steps = Object.fromEntries(
        ACTION_STEPS[action].map((step) => [step, "done"]),
      ) as Partial<Record<StudioActionStep, StudioStepState>>;
      setProgress({ action, steps });
      setStatus(await fetchStatus(surface));
      dismissTimer.current = window.setTimeout(() => setProgress(undefined), 1600);
    } else {
      setProgress((current) => {
        if (!current) return current;
        const steps = { ...current.steps };
        for (const step of ACTION_STEPS[action]) {
          if (steps[step] === "active") steps[step] = "failed";
        }
        return { ...current, steps, error: result.error };
      });
    }
  };

  const openPreview = () => {
    if (frame.width > 768) {
      window.open(previewSrc, "_blank");
      return;
    }
    const left = Math.max(0, window.screen.width / 2 - frame.width / 2);
    const top = Math.max(0, window.screen.height / 2 - frame.height / 2);
    const popup = window.open(
      previewSrc,
      "superwall-preview",
      `toolbar=no,location=no,status=no,menubar=no,scrollbars=no,resizable=no,width=${frame.width},height=${frame.height},top=${top},left=${left}`,
    );
    if (!popup) window.open(previewSrc, "_blank");
  };

  const responsive = deviceId === RESPONSIVE_ID;
  const device = deviceById(deviceId);
  const frame = responsive ? size : { width: device.width, height: device.height };

  const overrides: PreviewOverrides = {
    theme,
    locale,
    variables,
    device: responsive ? undefined : device.device,
  };
  const previewSrc = source.previewUrl(surface, overrides);
  const liveSrc = status.liveUrl ? withOverrides(status.liveUrl, overrides) : undefined;

  const compareOptions: CompareOption[] = [
    ...(actionsEnabled
      ? [
          {
            key: "live",
            label: "Live version",
            hint: "What SDKs receive today",
            target: { type: "live" } as const,
          },
        ]
      : []),
    ...source.surfaces
      .filter((candidate) => candidate !== surface)
      .map((candidate) => ({
        key: `surface:${candidate.kind}/${candidate.id}`,
        label: `${candidate.kind}/${candidate.id}`,
        hint: "Local preview",
        target: { type: "surface", surface: candidate } as const,
      })),
  ];

  const comparePane =
    compareWith &&
    (compareWith.type === "live"
      ? { label: "Live", src: liveSrc, title: `${surface.id} live` }
      : {
          label: `${compareWith.surface.kind}/${compareWith.surface.id}`,
          src: source.previewUrl(compareWith.surface, overrides),
          title: `${compareWith.surface.id} preview`,
        });

  const hasVariables = surface.variables && Object.keys(surface.variables).length > 0;
  const overrideCount = Object.keys(variables).length;

  return (
    <>
      <TopBar
        title={`${source.title} / ${surface.id}`}
        onHome={onBack}
        actions={
          <>
            <button
              type="button"
              className="sw-btn sw-btn--icon"
              aria-label="Reload preview"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RotateIcon />
            </button>
            <button
              type="button"
              className="sw-btn sw-btn--icon"
              aria-label="Open preview"
              onClick={openPreview}
            >
              <ExternalIcon />
            </button>
            {actionsEnabled && <ActionMenu progress={progress} onRun={ship} />}
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1">
          {comparePane && (
            <StagePane
              label={comparePane.label}
              width={frame.width}
              height={frame.height}
              title={comparePane.title}
              src={comparePane.src}
              reloadKey={reloadKey}
            />
          )}
          <StagePane
            label={comparePane ? "Local" : undefined}
            width={frame.width}
            height={frame.height}
            title={`${surface.id} preview`}
            src={previewSrc}
            reloadKey={reloadKey}
          />
        </div>

        {hasVariables && surface.variables && (
          <SidePanel open={panelOpen} title="Variables" onClose={() => setPanelOpen(false)}>
            <VariablesPanel schema={surface.variables} values={variables} onChange={setVariables} />
          </SidePanel>
        )}
      </div>

      <Toolbar>
        <ToolbarGroup label="Device">
          <Select
            label="Device"
            value={deviceId}
            options={[
              ...STUDIO_DEVICES.map((entry) => ({ value: entry.id, label: entry.name })),
              { value: RESPONSIVE_ID, label: "Responsive" },
            ]}
            onChange={setDeviceId}
          />
          {responsive && (
            <span className="flex items-center gap-1.5">
              <SizeInput
                label="Preview width"
                value={frame.width}
                onCommit={(width) => setSize((current) => ({ ...current, width }))}
              />
              <span className="text-cream/55">×</span>
              <SizeInput
                label="Preview height"
                value={frame.height}
                onCommit={(height) => setSize((current) => ({ ...current, height }))}
              />
            </span>
          )}
        </ToolbarGroup>
        <ToolbarGroup label="Theme">
          <Segmented
            label="Theme"
            value={theme}
            options={[
              { value: "light", label: <SunIcon /> },
              { value: "dark", label: <MoonIcon /> },
            ]}
            onChange={setTheme}
          />
        </ToolbarGroup>
        {surface.locales.length > 1 && (
          <ToolbarGroup label="Locale">
            <Select
              label="Locale"
              value={locale ?? "default"}
              options={[
                { value: "default", label: "Device" },
                ...surface.locales.map((entry) => ({ value: entry, label: entry })),
              ]}
              onChange={(value) => setLocale(value === "default" ? undefined : value)}
            />
          </ToolbarGroup>
        )}
        <ToolbarDivider />
        {compareOptions.length > 0 && (
          <CompareMenu active={compareWith} options={compareOptions} onSelect={setCompareWith} />
        )}
        {hasVariables && (
          <button
            type="button"
            className="sw-btn"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <SlidersIcon />
            Variables
            {overrideCount > 0 && <span className="text-accent">{overrideCount}</span>}
          </button>
        )}
      </Toolbar>
    </>
  );
};
