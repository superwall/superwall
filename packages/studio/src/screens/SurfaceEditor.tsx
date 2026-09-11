import * as React from "react";
import { hasIntroductoryOffer, type HostDelegate, type HostState } from "@superwall/host";
import { ActionMenu, type ActionProgress } from "../components/menus/ActionMenu";
import { CompareMenu, type CompareOption } from "../components/menus/CompareMenu";
import { DeviceFrame, DevicePlaceholder } from "../components/preview/DeviceFrame";
import { MissingProducts } from "../components/panels/MissingProducts";
import { PaywallToasts, useStudioDelegate } from "../components/PaywallToasts";
import { PreviewOnDevice } from "../components/PreviewOnDevice";
import { Segmented, Select, Switch } from "../components/controls";
import {
  ExternalIcon,
  MoonIcon,
  RotateDeviceIcon,
  RotateIcon,
  SlidersIcon,
  SunIcon,
} from "../components/icons";
import { SidePanel } from "../components/panels/SidePanel";
import { Toolbar, ToolbarDivider, ToolbarGroup } from "../components/chrome/Toolbar";
import { TopBar } from "../components/chrome/TopBar";
import {
  VariablesPanel,
  type VariableGroups,
  type VariableRow,
} from "../components/panels/VariablesPanel";
import { fetchStatus, runAction } from "../lib/actions";
import {
  DEFAULT_DEVICE_ID,
  deviceById,
  RESPONSIVE_DEFAULT,
  RESPONSIVE_ID,
  STUDIO_DEVICES,
  type DeviceChromeSpec,
} from "../lib/devices";
import { hostStateFor, studioDefaults } from "../lib/host";
import { hostedUrl } from "../lib/preview";
import { ACTION_STEPS, type StudioActionStep, type StudioStepState } from "../lib/steps";
import {
  hasActions,
  type CompareTarget,
  type Samples,
  type StudioActionName,
  type StudioSource,
  type StudioStatus,
  type StudioSurface,
} from "../lib/surfaces";
import { type VariableOverrides } from "../lib/variables";

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
  hostState,
  delegate,
  reloadKey,
  empty,
  chrome,
  landscape,
  theme,
}: {
  label?: string;
  width: number;
  height: number;
  title: string;
  src?: string;
  hostState: HostState;
  delegate: HostDelegate;
  reloadKey: number;
  empty?: string;
  chrome?: DeviceChromeSpec;
  landscape?: boolean;
  theme?: "light" | "dark";
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
            hostState={hostState}
            delegate={delegate}
            stageRef={paneRef}
            reloadKey={reloadKey}
            chrome={chrome}
            landscape={landscape}
            theme={theme}
          />
        ) : (
          <DevicePlaceholder width={width} height={height} stageRef={paneRef}>
            {empty ?? "Nothing live yet — publish to compare against production."}
          </DevicePlaceholder>
        )}
      </div>
    </div>
  );
};

const nameOf = (surface: StudioSurface): string => surface.label ?? `${surface.kind}/${surface.id}`;

export const SurfaceEditor = ({
  source,
  surface,
  samples,
  actions,
}: {
  source: StudioSource;
  surface: StudioSurface;
  samples: Samples;
  actions?: React.ReactNode;
}) => {
  const [deviceId, setDeviceId] = React.useState(DEFAULT_DEVICE_ID);
  const [size, setSize] = React.useState(RESPONSIVE_DEFAULT);
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  const [locale, setLocale] = React.useState<string | undefined>(undefined);
  const [edited, setEdited] = React.useState<VariableOverrides>({});
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [compareWith, setCompareWith] = React.useState<CompareTarget | undefined>(undefined);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [landscape, setLandscape] = React.useState(false);
  const [status, setStatus] = React.useState<StudioStatus>({});
  const [progress, setProgress] = React.useState<ActionProgress | undefined>(undefined);
  const dismissTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(dismissTimer.current), []);

  const actionsEnabled = hasActions(source);
  const delegate = useStudioDelegate();
  const defaults = React.useMemo(studioDefaults, [surface]);

  const locales = surface.locales;

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

  const responsive = deviceId === RESPONSIVE_ID;
  const device = deviceById(deviceId);
  const upright = responsive ? size : { width: device.width, height: device.height };
  const frame = landscape ? { width: upright.height, height: upright.width } : upright;

  const openPreview = () => {
    const standalone = source.standaloneUrl?.(surface);
    if (standalone === undefined) return;
    if (frame.width > 768) {
      window.open(standalone, "_blank");
      return;
    }
    const left = Math.max(0, window.screen.width / 2 - frame.width / 2);
    const top = Math.max(0, window.screen.height / 2 - frame.height / 2);
    const popup = window.open(
      standalone,
      "superwall-preview",
      `toolbar=no,location=no,status=no,menubar=no,scrollbars=no,resizable=no,width=${frame.width},height=${frame.height},top=${top},left=${left}`,
    );
    if (!popup) window.open(standalone, "_blank");
  };

  const hostState = React.useMemo(
    () =>
      hostStateFor({
        surface,
        defaults,
        sourceSamples: source.samples,
        samples,
        frame: responsive ? undefined : device.device,
        theme,
        locale,
        edited,
      }),
    [surface, defaults, source.samples, samples, responsive, device.device, theme, locale, edited],
  );
  const chrome = responsive ? undefined : device.chrome;
  const previewSrc = source.previewUrl(surface);
  const liveSrc = status.liveUrl ? hostedUrl(status.liveUrl) : undefined;

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
      .map((candidate, index) => ({
        key: `surface:${index}`,
        label: nameOf(candidate),
        hint: source.compareHint ?? "Local preview",
        target: { type: "surface", surface: candidate } as const,
      }))
      .filter((option) => option.target.surface !== surface),
  ];

  const comparePane =
    compareWith &&
    (compareWith.type === "live"
      ? {
          label: "Live",
          src: liveSrc,
          title: `${surface.id} live`,
          empty: status.unreachable
            ? `Couldn't read the live version — ${status.unreachable}`
            : undefined,
        }
      : {
          label: nameOf(compareWith.surface),
          src: source.previewUrl(compareWith.surface),
          title: `${nameOf(compareWith.surface)} preview`,
        });

  const groups = React.useMemo((): VariableGroups => {
    const rows = (prefix: string, record: Record<string, unknown> | undefined): VariableRow[] =>
      Object.entries(record ?? {})
        .map(([key, value]) => ({ path: `${prefix}.${key}`, value }))
        .toSorted((a, b) => a.path.localeCompare(b.path));

    return {
      user: rows("user", { ...defaults.user, ...source.samples?.user, ...samples.user }),
      device: rows("device", {
        ...defaults.device,
        ...source.samples?.device,
        ...samples.device,
        ...(device.device as Record<string, unknown>),
      }),
      params: rows("params", { ...defaults.params, ...source.samples?.params }),
      products: Object.entries(surface.products ?? {}).flatMap(([reference, identifier]) =>
        rows(`products.${reference}`, samples.products?.[identifier]),
      ),
    };
  }, [defaults, source.samples, samples, device.device, surface.products]);

  const missingProducts = React.useMemo(() => {
    if (!samples.products) return [];
    return Object.entries(surface.products ?? {})
      .filter(([, identifier]) => samples.products?.[identifier] === undefined)
      .map(([reference, identifier]) => ({ reference, identifier }));
  }, [samples.products, surface.products]);

  const [dismissedProducts, setDismissedProducts] = React.useState(false);
  React.useEffect(() => setDismissedProducts(false), [surface]);
  const unverified = samples.unreachable;
  const shippable = missingProducts.length === 0;
  const overrideCount =
    Object.keys(edited.user ?? {}).length +
    Object.keys(edited.params ?? {}).length +
    Object.keys(edited.device ?? {}).length;

  return (
    <>
      <PaywallToasts
        surfaceKey={`${surface.project ?? ""}/${surface.id}`}
        raised={Boolean(unverified)}
      />
      {missingProducts.length > 0 && !dismissedProducts && (
        <MissingProducts
          paywall={surface.id}
          missing={missingProducts}
          onDismiss={() => setDismissedProducts(true)}
        />
      )}
      {unverified && (
        <div className="border-b border-cream/10 bg-red/10 px-4 py-1.5 text-[0.8125rem] text-cream/75">
          Couldn't check this paywall's products — {unverified}
        </div>
      )}
      <TopBar
        title={`${surface.project ?? source.title} / ${surface.id}${
          surface.label ? ` · ${surface.label}` : ""
        }`}
        actions={
          <>
            {actions}
            <button
              type="button"
              className="sw-btn sw-btn--icon"
              aria-label="Reload preview"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RotateIcon />
            </button>
            {source.standaloneUrl && (
              <button
                type="button"
                className="sw-btn sw-btn--icon"
                aria-label="Open preview"
                onClick={openPreview}
              >
                <ExternalIcon />
              </button>
            )}
            <PreviewOnDevice source={source} surface={surface} />
            {actionsEnabled && (
              <ActionMenu
                progress={progress}
                blocked={
                  shippable
                    ? undefined
                    : `Superwall has no product for ${missingProducts
                        .map((entry) => entry.reference)
                        .join(", ")}`
                }
                onRun={ship}
                onBlocked={() => setDismissedProducts(false)}
              />
            )}
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
              hostState={hostState}
              delegate={delegate}
              reloadKey={reloadKey}
              empty={"empty" in comparePane ? comparePane.empty : undefined}
              chrome={chrome}
              landscape={landscape}
              theme={theme}
            />
          )}
          <StagePane
            label={comparePane ? (surface.label ?? "Local") : undefined}
            width={frame.width}
            height={frame.height}
            title={`${surface.id} preview`}
            src={previewSrc}
            hostState={hostState}
            delegate={delegate}
            reloadKey={reloadKey}
            chrome={chrome}
            landscape={landscape}
            theme={theme}
          />
        </div>

        <SidePanel open={panelOpen} title="Variables" onClose={() => setPanelOpen(false)}>
          <VariablesPanel overrides={edited} groups={groups} onChange={setEdited} />
        </SidePanel>
      </div>

      <Toolbar>
        <ToolbarGroup label="Intro offer">
          <Switch
            label="Introductory offer"
            checked={hasIntroductoryOffer(hostState)}
            onChange={(checked) =>
              setEdited((current) => ({ ...current, introductoryOfferEligible: checked }))
            }
          />
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
          <button
            type="button"
            className="sw-btn sw-btn--icon"
            aria-label="Rotate device"
            aria-pressed={landscape}
            title={landscape ? "Back to portrait" : "Rotate to landscape"}
            onClick={() => setLandscape((value) => !value)}
          >
            <span
              className={`flex transition-transform duration-200 ${landscape ? "-rotate-90" : ""}`}
            >
              <RotateDeviceIcon />
            </span>
          </button>
        </ToolbarGroup>
        <ToolbarDivider />
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
        {locales.length > 1 && (
          <ToolbarGroup label="Locale">
            <Select
              label="Locale"
              value={locale ?? "default"}
              options={[
                { value: "default", label: "Device" },
                ...locales.map((entry) => ({ value: entry, label: entry })),
              ]}
              onChange={(value) => setLocale(value === "default" ? undefined : value)}
            />
          </ToolbarGroup>
        )}
        <ToolbarDivider />
        {compareOptions.length > 0 && (
          <CompareMenu active={compareWith} options={compareOptions} onSelect={setCompareWith} />
        )}
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
      </Toolbar>
    </>
  );
};
