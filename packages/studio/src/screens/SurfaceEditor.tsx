import * as React from "react";
import { hasIntroductoryOffer, type HostDelegate, type HostState } from "@superwall/host";
import { ActionMenu, type ActionProgress } from "../components/menus/ActionMenu";
import { CompareMenu, type CompareOption } from "../components/menus/CompareMenu";
import { compareAdded, compareSwapped, followDrafts } from "../lib/compare";
import {
  Canvas,
  useCanvasScale,
  type CanvasHandle,
  type CanvasZoom,
} from "../components/preview/Canvas";
import { DeviceFrame, DevicePlaceholder } from "../components/preview/DeviceFrame";
import { type FrameSize, ResizeHandles } from "../components/preview/ResizeHandles";
import { MissingProducts } from "../components/panels/MissingProducts";
import { PaywallToasts, useStudioDelegate } from "../components/PaywallToasts";
import { DownloadScreenshot } from "../components/DownloadScreenshot";
import { PreviewOnDevice } from "../components/PreviewOnDevice";
import { Segmented, Select, Switch } from "../components/controls";
import {
  AlertTriangleIcon,
  ExternalIcon,
  MinusIcon,
  MoonIcon,
  PlusIcon,
  RotateDeviceIcon,
  RotateIcon,
  SlidersIcon,
  SunIcon,
  XIcon,
} from "../components/icons";
import { Tooltip } from "../components/Tooltip";
import { HostPanel, SidePanel } from "../components/panels/SidePanel";
import { Toolbar, ToolbarDivider, ToolbarGroup } from "../components/chrome/Toolbar";
import { TopBar } from "../components/chrome/TopBar";
import {
  VariablesPanel,
  type VariableGroups,
  type VariableRow,
} from "../components/panels/VariablesPanel";
import {
  chromeFor,
  DEFAULT_DEVICE_ID,
  deviceById,
  deviceVariablesFor,
  isWebOnly,
  webViewportFor,
  RESPONSIVE_DEFAULT,
  RESPONSIVE_ID,
  STUDIO_DEVICES,
  type DeviceChromeSpec,
} from "../lib/devices";
import {
  COMPARE_MAX,
  editVariable,
  findDevice,
  variableOverrides,
  type CompareOptionKind,
  type StudioCommand,
  type StudioCommandError,
  type StudioHandle,
  type StudioState,
} from "../lib/commands";
import { hostStateFor, previewDevice, studioDefaults } from "../lib/host";
import { percent } from "../lib/canvas";
import { hostedUrl, originalUrl } from "../lib/preview";
import { latestVersion, liveVersion } from "../lib/promotion";
import { ACTION_STEPS, type StudioActionStep, type StudioStepState } from "../lib/steps";
import {
  hasOriginal,
  isScreenOrigin,
  SCREEN_FRAMEWORK_LABEL,
  type CompareTarget,
  type Samples,
  type StudioActionName,
  type StudioDraft,
  type StudioPresentation,
  type StudioResume,
  type StudioSource,
  type StudioStatus,
  type StudioSurface,
  type StudioVersion,
} from "../lib/surfaces";
import { useStudioMode } from "../lib/studio-host";
import { timeAgo } from "../lib/time";
import { type VariableOverrides } from "../lib/variables";

const STEPPER =
  "flex w-8 items-center justify-center outline-none transition-colors duration-hover hover:bg-accent focus-visible:bg-accent hover:[&>svg]:filter-none focus-visible:[&>svg]:filter-none";

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
      className="sw-input w-16 text-center tabular-nums"
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
  labelActions,
  order,
  width,
  height,
  title,
  src,
  image,
  hostState,
  delegate,
  reloadKey,
  empty,
  chrome,
  presentation,
  landscape,
  theme,
  onResize,
  canvas,
}: {
  label?: string;
  /** Controls beside the label, at the label's size whatever the zoom. */
  labelActions?: React.ReactNode;
  /** Its place on the stage; set by order rather than position so moving it never reloads it. */
  order?: number;
  width: number;
  height: number;
  title: string;
  src?: string;
  image?: string;
  hostState: HostState;
  delegate: HostDelegate;
  reloadKey: number;
  empty?: string;
  chrome?: DeviceChromeSpec;
  presentation?: StudioPresentation;
  landscape?: boolean;
  theme?: "light" | "dark";
  onResize?: (next: FrameSize) => void;
  canvas?: React.RefObject<CanvasHandle | null>;
}) => {
  const scale = useCanvasScale();
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => setBroken(false), [image]);
  return (
    <div
      className="flex flex-none flex-col gap-2"
      style={order === undefined ? undefined : { order }}
    >
      {label && (
        <div
          className="flex origin-bottom-left items-center gap-1.5 text-xs whitespace-nowrap text-fg-tertiary"
          // Drawn at its own size whatever the zoom, and never wider than the pane under it.
          style={{ transform: `scale(${1 / scale})`, maxWidth: width * scale }}
          onPointerDown={labelActions ? (event) => event.stopPropagation() : undefined}
        >
          <span className="min-w-0 truncate">{label}</span>
          {labelActions && (
            <span className="flex flex-none items-center gap-1">{labelActions}</span>
          )}
        </div>
      )}
      <div className="relative">
        {image && !broken ? (
          <div
            className="flex flex-none items-center justify-center overflow-hidden bg-black"
            style={{ width, height }}
          >
            <img
              src={image}
              alt={title}
              title={title}
              className="max-h-full max-w-full object-contain"
              draggable={false}
              onError={() => setBroken(true)}
            />
          </div>
        ) : src ? (
          <DeviceFrame
            width={width}
            height={height}
            title={title}
            src={src}
            hostState={hostState}
            delegate={delegate}
            reloadKey={reloadKey}
            chrome={chrome}
            presentation={presentation}
            landscape={landscape}
            theme={theme}
          />
        ) : (
          <DevicePlaceholder width={width} height={height}>
            {empty ?? "Nothing live yet — publish to compare against production."}
          </DevicePlaceholder>
        )}
        {onResize && (
          <ResizeHandles
            size={{ width, height }}
            scale={scale}
            clamp={clampSize}
            onResize={onResize}
            onDragStart={() => canvas?.current?.hold()}
            onShift={(dx, dy) => canvas?.current?.pan(dx, dy)}
          />
        )}
      </div>
    </div>
  );
};

const CanvasFooter = ({ children }: React.PropsWithChildren) => {
  const scale = useCanvasScale();
  return (
    <div
      className="w-fit origin-top self-center"
      style={{ transform: `scale(${1 / scale})` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
};

// The id is left out where the title already says it (a draft named by its folder).
const editorTitle = (surface: StudioSurface, sourceTitle: string): string => {
  const head = surface.project ?? sourceTitle;
  const id = surface.label && surface.id !== head ? ` · ${surface.id}` : "";
  return `${head} / ${surface.label ?? surface.id}${id}`;
};

const nameOf = (surface: StudioSurface): string => surface.label ?? `${surface.kind}/${surface.id}`;

const draftKey = (draft: StudioDraft): string => `draft:${draft.key}`;

const NO_DRAFTS: readonly StudioDraft[] = [];

const unknownOption = (wanted: string) =>
  `nothing to compare called ${JSON.stringify(wanted)}; see state.compareOptions`;

const optionKind = (target: CompareTarget): CompareOptionKind => target.type;

// A compared draft sits where it was built among the others; the rest sit first, as compared.
const DRAFT_RANK = 100;
const STAGE_RANK = 1000;

/**
 * A host's panel beside the stage (an agent chat): its content is the host's.
 * Its width is the studio's (remembered) unless the host passes
 * `onWidthChange`, which makes `width` the host's; see `HostPanel`.
 */
export type StudioPanel = {
  open: boolean;
  label: string;
  content: React.ReactNode;
  width?: number;
  onWidthChange?: (width: number | undefined) => void;
};

// The Variables panel's `w-80`.
const VARIABLES_WIDTH = 320;

// The panels' `duration-move`, plus a frame.
const PANEL_MOVE_MS = 220;

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

export const SurfaceEditor = ({
  source,
  surface,
  samples,
  actions,
  panel,
  resume,
  onResumed,
  ref,
}: {
  source: StudioSource;
  surface: StudioSurface;
  samples: Samples;
  actions?: React.ReactNode;
  panel?: StudioPanel;
  /**
   * What a push of the unsaved surface was made for (`StudioActionRequest`'s
   * `resume`), finished here once the host moved to the saved one, then
   * `onResumed`.
   */
  resume?: StudioResume;
  onResumed?: () => void;
  /** Drives the editor's own controls (`StudioCommand`) and reads them back. */
  ref?: React.Ref<StudioHandle>;
}) => {
  const [deviceId, setDeviceId] = React.useState(DEFAULT_DEVICE_ID);
  const [size, setSize] = React.useState(RESPONSIVE_DEFAULT);
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  const [locale, setLocale] = React.useState<string | undefined>(undefined);
  const [edited, setEdited] = React.useState<VariableOverrides>({});
  const [panelOpen, setPanelOpen] = React.useState(false);
  const drafts = source.drafts ?? NO_DRAFTS;
  const offStage = drafts.filter((draft) => !draft.onStage).map(draftKey);
  // Compared options' keys. The newest drafts open compared beside the one on stage.
  const [compared, setCompared] = React.useState<string[]>(() =>
    hasOriginal(surface) && new URLSearchParams(window.location.search).get("compare") === "origin"
      ? ["origin"]
      : offStage.slice(-COMPARE_MAX),
  );
  const seenDrafts = React.useRef<ReadonlySet<string>>(new Set(offStage));
  const offStageKey = offStage.join("\n");
  React.useEffect(() => {
    const seen = seenDrafts.current;
    if (offStage.every((key) => seen.has(key))) return;
    seenDrafts.current = new Set([...seen, ...offStage]);
    setCompared((current) => followDrafts(current, seen, offStage));
    // `offStage` is rebuilt every render; its keys are what matter.
  }, [offStageKey]);
  const [deviceRequest, setDeviceRequest] = React.useState({ open: false, key: 0 });
  const [deviceOpen, setDeviceOpen] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [landscape, setLandscape] = React.useState(false);
  const canvas = React.useRef<CanvasHandle>(null);
  const [zoom, setZoom] = React.useState<CanvasZoom>({ scale: 1, fitted: true });
  const [status, setStatus] = React.useState<StudioStatus>({});
  const [picked, setPicked] = React.useState<number | undefined>(undefined);
  const [progress, setProgress] = React.useState<ActionProgress | undefined>(undefined);
  const dismissTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(dismissTimer.current), []);

  const shipping = source.actions;
  const delegate = useStudioDelegate();
  const defaults = React.useMemo(studioDefaults, [surface]);

  const locales = surface.locales;

  React.useEffect(() => {
    if (!shipping) return;
    let cancelled = false;
    setPicked(undefined);
    shipping.status(surface).then((value) => {
      if (!cancelled) setStatus(value);
    });
    return () => {
      cancelled = true;
    };
  }, [shipping, surface]);

  const ship = async (action: StudioActionName, then?: StudioResume) => {
    if (!shipping) return;
    window.clearTimeout(dismissTimer.current);
    setProgress({ action, steps: {} });

    const version = action === "promote" ? (surface.version ?? picked) : undefined;
    const request = then ? { action, version, resume: then } : { action, version };
    const result = await shipping.run(surface, request, (step, state) => {
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
      setPicked(undefined);
      setStatus(await shipping.status(surface));
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

  // Read at mount: the host drops `resume` once told, and the dialog it
  // opened stays open.
  const [resuming] = React.useState(resume);
  React.useEffect(() => {
    if (resuming !== undefined) onResumed?.();
    // `onResumed` changes every render; this runs once.
  }, [resuming]);

  // A hosted surface with no paywall is not in the account yet (an agent's
  // build, say): pushing it is the only way to give a device something to open.
  const hosted = useStudioMode() === "hosted";
  const unsaved =
    hosted && surface.paywallId === undefined && shipping?.offered.includes("push") === true;
  const shippingBusy =
    progress !== undefined &&
    progress.error === undefined &&
    ACTION_STEPS[progress.action].some((step) => progress.steps[step] !== "done");

  const responsive = deviceId === RESPONSIVE_ID;
  const device = deviceById(deviceId);
  const web = isWebOnly(surface.platforms);
  const frameDevice = React.useMemo(
    () => deviceVariablesFor(device, web, landscape),
    [device, web, landscape],
  );
  const upright = responsive
    ? size
    : web
      ? webViewportFor(device)
      : { width: device.width, height: device.height };
  const presentation = web ? undefined : surface.presentation;
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
        frame: responsive ? undefined : frameDevice,
        theme,
        locale,
        edited,
      }),
    [surface, defaults, source.samples, samples, responsive, frameDevice, theme, locale, edited],
  );
  const chrome = responsive ? undefined : chromeFor(device, web);
  const previewSrc = source.previewUrl(surface);
  const versions = status.versions ?? [];
  const promotion = {
    target: surface.version ?? picked ?? latestVersion(versions),
    live: liveVersion(versions),
    versions,
    pick: surface.version === undefined ? setPicked : shipping?.pick,
  };
  const versionLabel = (entry: StudioVersion) => `v${entry.version}${entry.live ? " · Live" : ""}`;
  const pushedHint = (entry: StudioVersion) => {
    if (entry.live) return "What SDKs receive today";
    const ago = entry.pushedAt ? timeAgo(entry.pushedAt) : undefined;
    return ago ? `Pushed ${ago}` : "Pushed snapshot";
  };

  const compareOptions: CompareOption[] = [
    ...drafts
      .filter((draft) => !draft.onStage)
      .map((draft) => ({
        key: draftKey(draft),
        label: draft.label,
        hint: draft.hint ?? "Not pushed yet",
        target: { type: "draft", draft } as const,
      })),
    ...(surface.origin && hasOriginal(surface)
      ? [
          {
            key: "origin",
            label: "Original",
            hint: isScreenOrigin(surface.origin)
              ? `${SCREEN_FRAMEWORK_LABEL[surface.origin.framework]} screen ${surface.origin.path}, as captured in the simulator`
              : `Dashboard paywall ${surface.origin.paywallId}, as it serves today`,
            target: { type: "origin" } as const,
          },
        ]
      : []),
    ...versions.map((entry) => ({
      key: `version:${entry.version}`,
      label: versionLabel(entry),
      hint: pushedHint(entry),
      target: { type: "version", version: entry.version } as const,
    })),
    ...source.surfaces
      .map((candidate) => ({
        key: `surface:${candidate.kind}/${candidate.id}`,
        label: nameOf(candidate),
        hint: source.compareHint ?? "Local preview",
        target: { type: "surface", surface: candidate } as const,
      }))
      .filter((option) => option.target.surface !== surface),
  ];
  const compareNotice = status.unreachable
    ? `Couldn’t read the pushed versions — ${status.unreachable}`
    : undefined;
  const stageDraft = drafts.find((draft) => draft.onStage);
  const comparedOptions = compared.flatMap((key) => {
    const option = compareOptions.find((entry) => entry.key === key);
    return option ? [option] : [];
  });

  const paneFor = (target: CompareTarget) => {
    if (target.type === "version") {
      const entry = versions.find((candidate) => candidate.version === target.version);
      return {
        label: entry ? versionLabel(entry) : `v${target.version}`,
        src: entry ? hostedUrl(entry.url) : undefined,
        title: `${surface.id} v${target.version}`,
        empty: compareNotice ?? "This version is no longer on the dashboard.",
        presentation,
      };
    }
    if (target.type === "draft") {
      return {
        label: target.draft.label,
        src: hostedUrl(target.draft.url),
        title: `${target.draft.label} preview`,
        presentation: web ? undefined : (target.draft.presentation ?? presentation),
      };
    }
    if (target.type === "origin") {
      return {
        label: "Original",
        ...(surface.origin && isScreenOrigin(surface.origin)
          ? { image: surface.origin.screenshot ? originalUrl(surface) : undefined }
          : { src: surface.origin?.url }),
        title: `${surface.id} original`,
        empty:
          surface.origin && isScreenOrigin(surface.origin)
            ? "The original’s screenshot is missing — capture it again with `superwall migrate --screen <path> --screenshot <file>`."
            : "This paywall was not rebuilt from a dashboard paywall or a native screen.",
        presentation,
      };
    }
    return {
      label: nameOf(target.surface),
      src: source.previewUrl(target.surface),
      title: `${nameOf(target.surface)} preview`,
      presentation: web ? undefined : target.surface.presentation,
    };
  };

  const draftRank = (key: string) =>
    DRAFT_RANK + drafts.findIndex((draft) => draftKey(draft) === key);
  const comparePanes = comparedOptions
    .map((option, index) => ({
      option,
      pane: paneFor(option.target),
      rank: option.target.type === "draft" ? draftRank(option.key) : index,
    }))
    .toSorted((a, b) => a.rank - b.rank);
  const stageRank = stageDraft ? draftRank(draftKey(stageDraft)) : STAGE_RANK;
  const comparing = comparePanes.length > 0;

  const groups = React.useMemo((): VariableGroups => {
    const rows = (prefix: string, record: Record<string, unknown> | undefined): VariableRow[] =>
      Object.entries(record ?? {})
        .map(([key, value]) => ({ path: `${prefix}.${key}`, value }))
        .toSorted((a, b) => a.path.localeCompare(b.path));

    return {
      user: rows("user", { ...defaults.user, ...source.samples?.user, ...samples.user }),
      device: rows(
        "device",
        previewDevice({
          ...defaults.device,
          ...source.samples?.device,
          ...samples.device,
          ...frameDevice,
        }),
      ),
      params: rows("params", { ...defaults.params, ...source.samples?.params }),
      products: Object.entries(surface.products ?? {}).flatMap(([reference, identifier]) =>
        rows(`products.${reference}`, samples.products?.[identifier]),
      ),
    };
  }, [defaults, source.samples, samples, frameDevice, surface.products]);

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

  const stageKey = stageDraft
    ? draftKey(stageDraft)
    : surface.version !== undefined
      ? `version:${surface.version}`
      : `surface:${surface.kind}/${surface.id}`;

  const findOption = (wanted: string): CompareOption | undefined => {
    const needle = wanted.trim().toLowerCase();
    return compareOptions.find(
      (entry) =>
        entry.key.toLowerCase() === needle ||
        entry.label.toLowerCase() === needle ||
        (entry.target.type === "draft" && entry.target.draft.key.toLowerCase() === needle),
    );
  };
  const isStage = (wanted: string): boolean => {
    const needle = wanted.trim().toLowerCase();
    return (
      stageKey.toLowerCase() === needle ||
      (stageDraft !== undefined &&
        (stageDraft.key.toLowerCase() === needle || stageDraft.label.toLowerCase() === needle))
    );
  };

  const selectDraft = (draft: StudioDraft): string | undefined => {
    if (draft.onStage) return undefined;
    if (!source.selectDraft) return "this studio cannot put another build on stage";
    source.selectDraft(draft.key);
    return undefined;
  };

  const readState = (): StudioState => {
    const shown = canvas.current?.zoom() ?? zoom;
    return {
      surface: {
        id: surface.id,
        ...(surface.label ? { label: surface.label } : {}),
        ...(surface.version === undefined ? {} : { version: surface.version }),
      },
      device: responsive
        ? { id: RESPONSIVE_ID, name: "Responsive", ...frame }
        : { id: device.id, name: device.name, ...frame },
      devices: [
        ...STUDIO_DEVICES.map((entry) => ({ id: entry.id, name: entry.name })),
        { id: RESPONSIVE_ID, name: "Responsive" },
      ],
      orientation: landscape ? "landscape" : "portrait",
      theme,
      locale: locale ?? null,
      locales: [...locales],
      introductoryOffer: {
        eligible: hasIntroductoryOffer(hostState),
        overridden: edited.introductoryOfferEligible !== undefined,
      },
      zoom: { percent: Math.round(shown.scale * 100), fitted: shown.fitted },
      variables: variableOverrides(edited),
      variablesPanel: panelOpen,
      versions: versions.map((entry) => ({ version: entry.version, live: entry.live === true })),
      stage: stageKey,
      compare: comparePanes.map(({ option }) => option.key),
      compareMax: COMPARE_MAX,
      compareOptions: compareOptions.map((option) => ({
        key: option.key,
        label: option.label,
        kind: optionKind(option.target),
      })),
      drafts: drafts.map((draft) => ({
        key: draftKey(draft),
        label: draft.label,
        onStage: draft.onStage === true,
      })),
      previewOnDevice: deviceOpen,
    };
  };

  const applyCommand = (command: StudioCommand): string | undefined => {
    switch (command.type) {
      case "zoom":
        if (!canvas.current) return "the canvas is not on screen";
        if (command.to === "in") canvas.current.zoomStep(1);
        else if (command.to === "out") canvas.current.zoomStep(-1);
        else if (command.to === "fit") canvas.current.fit();
        else if (command.to === "actual") canvas.current.actualSize();
        else canvas.current.zoomTo(command.to / 100);
        return undefined;
      case "device": {
        const found = findDevice(command.device);
        if (!found) return `no device ${JSON.stringify(command.device)}; see state.devices`;
        setDeviceId(found === RESPONSIVE_ID ? RESPONSIVE_ID : found.id);
        return undefined;
      }
      case "size":
        setDeviceId(RESPONSIVE_ID);
        setSize((current) => ({
          width:
            command.width === undefined ? current.width : clampSize(command.width, current.width),
          height:
            command.height === undefined
              ? current.height
              : clampSize(command.height, current.height),
        }));
        return undefined;
      case "orientation":
        setLandscape(command.orientation === "landscape");
        return undefined;
      case "theme":
        setTheme(command.theme);
        return undefined;
      case "locale": {
        if (command.locale === null) {
          setLocale(undefined);
          return undefined;
        }
        const wanted = command.locale.toLowerCase().replace("_", "-");
        const match = locales.find((entry) => entry.toLowerCase().replace("_", "-") === wanted);
        if (!match) {
          return locales.length > 0
            ? `this paywall has no ${command.locale} locale; it has ${locales.join(", ")}`
            : "this paywall has one language only";
        }
        setLocale(match);
        return undefined;
      }
      case "introductoryOffer":
        setEdited((current) => {
          const { introductoryOfferEligible: _offer, ...rest } = current;
          return command.eligible === null
            ? rest
            : { ...rest, introductoryOfferEligible: command.eligible };
        });
        return undefined;
      case "variable": {
        const checked = editVariable({}, command.path, command.value);
        if ("error" in checked) return checked.error;
        setEdited((current) => {
          const edit = editVariable(current, command.path, command.value);
          return "overrides" in edit ? edit.overrides : current;
        });
        return undefined;
      }
      case "resetVariables":
        setEdited((current) =>
          current.introductoryOfferEligible === undefined
            ? {}
            : { introductoryOfferEligible: current.introductoryOfferEligible },
        );
        return undefined;
      case "variablesPanel":
        setPanelOpen(command.open);
        return undefined;
      case "version":
        if (!promotion.pick) return "this studio cannot switch versions";
        if (!versions.some((entry) => entry.version === command.version)) {
          return `there is no v${command.version}; see state.versions`;
        }
        promotion.pick(command.version);
        return undefined;
      case "compare": {
        const wanted =
          command.with === null
            ? []
            : typeof command.with === "string"
              ? [command.with]
              : command.with;
        const besides = wanted.filter((entry) => !isStage(entry));
        const unknown = besides.filter((entry) => !findOption(entry));
        if (unknown.length > 0) return unknownOption(unknown[0]!);
        const keys = [...new Set(besides.map((entry) => findOption(entry)!.key))];
        if (keys.length > COMPARE_MAX) {
          return `the stage compares at most ${COMPARE_MAX} beside the one on it; put another on stage with select`;
        }
        setCompared(keys);
        return undefined;
      }
      case "compareAdd": {
        if (isStage(command.with)) return `${command.with} is on stage already`;
        const option = findOption(command.with);
        if (!option) return unknownOption(command.with);
        setCompared((current) => compareAdded(current, option.key));
        return undefined;
      }
      case "compareRemove": {
        const option = findOption(command.with);
        if (!option) return unknownOption(command.with);
        setCompared((current) => current.filter((key) => key !== option.key));
        return undefined;
      }
      case "compareSwap": {
        const from = findOption(command.from);
        if (!from || !compared.includes(from.key)) {
          return `${JSON.stringify(command.from)} is not compared; see state.compare`;
        }
        if (isStage(command.to)) return `${command.to} is on stage already`;
        const to = findOption(command.to);
        if (!to) return unknownOption(command.to);
        setCompared((current) => compareSwapped(current, from.key, to.key));
        return undefined;
      }
      case "select": {
        if (isStage(command.with)) return undefined;
        const option = findOption(command.with);
        if (option?.target.type !== "draft") {
          return option?.target.type === "version"
            ? `${command.with} is a pushed version; show it with version`
            : `no draft called ${JSON.stringify(command.with)}; see state.drafts`;
        }
        return selectDraft(option.target.draft);
      }
      case "previewOnDevice":
        setDeviceRequest((current) => ({ open: command.open, key: current.key + 1 }));
        return undefined;
      case "reload":
        setReloadKey((key) => key + 1);
        return undefined;
    }
  };

  const latestCommands = React.useRef({ applyCommand, readState });
  latestCommands.current = { applyCommand, readState };
  const [commits, setCommits] = React.useState(0);
  const waiting = React.useRef(new Map<number, () => void>());
  React.useEffect(() => {
    const ready = waiting.current.get(commits);
    if (!ready) return;
    waiting.current.delete(commits);
    ready();
  }, [commits]);
  // A command that moved the host elsewhere (select) unmounts the editor
  // before its commit: answer with what it showed last rather than never.
  React.useEffect(
    () => () => {
      const pending = [...waiting.current.values()];
      waiting.current.clear();
      pending.forEach((ready) => ready());
    },
    [],
  );

  React.useImperativeHandle(
    ref,
    (): StudioHandle => ({
      state: () => latestCommands.current.readState(),
      run: (commands) => {
        const errors: StudioCommandError[] = [];
        const apply = (index: number) => {
          const command = commands[index]!;
          const error = latestCommands.current.applyCommand(command);
          if (error) errors.push({ index, type: command.type, error });
        };
        // Zoom goes last, once the stage it zooms has settled: a device or
        // orientation change refits the canvas when it commits.
        const zooms: number[] = [];
        commands.forEach((command, index) => {
          if (command.type === "zoom") zooms.push(index);
          else apply(index);
        });
        return new Promise((resolve) => {
          const settle = async () => {
            if (zooms.length > 0) {
              await nextFrame();
              // A panel opening or closing narrows the canvas for one move.
              if (commands.some((command) => command.type === "variablesPanel")) {
                await new Promise((wait) => window.setTimeout(wait, PANEL_MOVE_MS));
              }
              zooms.forEach(apply);
            }
            // A refit lands on the next measure, a frame or two on.
            await nextFrame();
            await nextFrame();
            errors.sort((a, b) => a.index - b.index);
            resolve({ ok: errors.length === 0, errors, state: latestCommands.current.readState() });
          };
          setCommits((count) => {
            const next = count + 1;
            waiting.current.set(next, () => void settle());
            return next;
          });
        });
      },
    }),
    [],
  );

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
      <TopBar
        title={editorTitle(surface, source.title)}
        actions={
          <>
            {actions}
            <span className="flex items-center gap-0.5">
              <Tooltip hint="Reload preview">
                <button
                  type="button"
                  className="sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost"
                  aria-label="Reload preview"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  <RotateIcon />
                </button>
              </Tooltip>
              {source.standaloneUrl && (
                <Tooltip hint="Open preview">
                  <button
                    type="button"
                    className="sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost"
                    aria-label="Open preview"
                    onClick={openPreview}
                  >
                    <ExternalIcon />
                  </button>
                </Tooltip>
              )}
              <DownloadScreenshot source={source} surface={surface} />
            </span>
            <PreviewOnDevice
              source={source}
              surface={surface}
              autoOpen={resuming === "preview"}
              pushFirst={unsaved ? () => void ship("push", "preview") : undefined}
              disabled={unsaved && shippingBusy}
              request={deviceRequest}
              onOpenChange={setDeviceOpen}
            />
            {shipping && (
              <ActionMenu
                offered={shipping.offered}
                promotion={promotion}
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
      {unverified && (
        <div
          role="status"
          className="relative z-10 flex flex-none items-center gap-2 border-b border-border bg-warning/8 px-4 py-2 text-sm text-warning-foreground"
        >
          <AlertTriangleIcon />
          <span className="min-w-0 truncate">
            Couldn’t check this paywall’s products{" "}
            <span className="text-warning-foreground/80">· {unverified}</span>
          </span>
        </div>
      )}

      <div className="@container relative flex min-h-0 flex-1">
        {panel && (
          <HostPanel
            open={panel.open}
            label={panel.label}
            width={panel.width}
            onWidthChange={panel.onWidthChange}
            reserve={panelOpen ? VARIABLES_WIDTH : 0}
          >
            {panel.content}
          </HostPanel>
        )}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden" data-testid="stage-column">
          <div className="relative flex min-h-0 flex-1">
            <Canvas
              ref={canvas}
              onZoom={setZoom}
              fitKey={[
                deviceId,
                responsive ? "" : `${frame.width}x${frame.height}`,
                comparing ? `compare:${comparePanes.length}` : "single",
                presentation?.style ?? "",
              ].join(":")}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-16">
                  {comparePanes.map(({ option, pane, rank }) => (
                    <StagePane
                      key={option.key}
                      order={rank}
                      label={pane.label}
                      labelActions={
                        <>
                          {option.target.type === "draft" && source.selectDraft && (
                            <button
                              type="button"
                              className="sw-btn sw-btn--sm sw-btn--ghost h-5 px-1.5 text-xs"
                              aria-label={`Open ${pane.label}`}
                              onClick={() => {
                                if (option.target.type === "draft")
                                  selectDraft(option.target.draft);
                              }}
                            >
                              Open
                            </button>
                          )}
                          <button
                            type="button"
                            className="sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost size-5"
                            aria-label={`Stop comparing ${pane.label}`}
                            onClick={() =>
                              setCompared((current) => current.filter((key) => key !== option.key))
                            }
                          >
                            <XIcon />
                          </button>
                        </>
                      }
                      width={frame.width}
                      height={frame.height}
                      title={pane.title}
                      src={"src" in pane ? pane.src : undefined}
                      image={"image" in pane ? pane.image : undefined}
                      presentation={pane.presentation}
                      hostState={hostState}
                      delegate={delegate}
                      reloadKey={reloadKey}
                      empty={"empty" in pane ? pane.empty : undefined}
                      chrome={chrome}
                      landscape={landscape}
                      theme={theme}
                    />
                  ))}
                  <StagePane
                    order={stageRank}
                    label={comparing ? (stageDraft?.label ?? surface.label ?? "Local") : undefined}
                    width={frame.width}
                    height={frame.height}
                    title={`${surface.id} preview`}
                    src={previewSrc}
                    presentation={presentation}
                    hostState={hostState}
                    delegate={delegate}
                    reloadKey={reloadKey}
                    chrome={chrome}
                    landscape={landscape}
                    theme={theme}
                    onResize={
                      responsive
                        ? (next) =>
                            setSize(landscape ? { width: next.height, height: next.width } : next)
                        : undefined
                    }
                    canvas={canvas}
                  />
                </div>
                <CanvasFooter>
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-fg-secondary select-none">
                    <Switch
                      label="Introductory offer"
                      checked={hasIntroductoryOffer(hostState)}
                      onChange={(checked) =>
                        setEdited((current) => ({ ...current, introductoryOfferEligible: checked }))
                      }
                    />
                    Introductory offer
                  </label>
                </CanvasFooter>
              </div>
            </Canvas>
          </div>

          <Toolbar>
            <ToolbarGroup label="Zoom">
              <div
                className="flex h-8 flex-none overflow-hidden rounded-sm border border-border transition-colors duration-hover has-[:focus-visible]:border-primary"
                role="group"
                aria-label="Zoom"
              >
                <button
                  type="button"
                  className={STEPPER}
                  aria-label="Zoom out"
                  onClick={() => canvas.current?.zoomStep(-1)}
                >
                  <MinusIcon className="icon-tertiary" />
                </button>
                <button
                  type="button"
                  className="min-w-14 border-x border-border px-2 text-sm tabular-nums outline-none transition-colors duration-hover hover:bg-accent focus-visible:bg-accent"
                  aria-label="Fit to view"
                  aria-pressed={zoom.fitted}
                  onClick={() => canvas.current?.fit()}
                >
                  {percent(zoom.scale)}
                </button>
                <button
                  type="button"
                  className={STEPPER}
                  aria-label="Zoom in"
                  onClick={() => canvas.current?.zoomStep(1)}
                >
                  <PlusIcon className="icon-tertiary" />
                </button>
              </div>
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
              <Tooltip
                side="top"
                align="center"
                hint={landscape ? "Back to portrait" : "Rotate to landscape"}
              >
                <button
                  type="button"
                  className="sw-btn sw-btn--icon"
                  aria-label="Rotate device"
                  aria-pressed={landscape}
                  onClick={() => setLandscape((value) => !value)}
                >
                  <RotateDeviceIcon
                    className={`transition-disclosure ${landscape ? "-rotate-90" : ""}`}
                  />
                </button>
              </Tooltip>
              <Segmented
                label="Theme"
                value={theme}
                options={[
                  { value: "light", label: <SunIcon />, name: "Light" },
                  { value: "dark", label: <MoonIcon />, name: "Dark" },
                ]}
                onChange={setTheme}
              />
              {responsive && (
                <span className="flex items-center gap-1.5">
                  <SizeInput
                    label="Preview width"
                    value={frame.width}
                    onCommit={(width) => setSize((current) => ({ ...current, width }))}
                  />
                  <span className="text-fg-tertiary">×</span>
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
            {(shipping || compareOptions.length > 0) && (
              <CompareMenu
                active={comparePanes.map(({ option }) => option.key)}
                options={compareOptions}
                notice={compareNotice}
                limit={COMPARE_MAX}
                onToggle={(option) =>
                  setCompared((current) =>
                    current.includes(option.key)
                      ? current.filter((key) => key !== option.key)
                      : compareAdded(current, option.key),
                  )
                }
                onClear={() => setCompared([])}
              />
            )}
            <button
              type="button"
              className="sw-btn"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((open) => !open)}
            >
              <SlidersIcon />
              Variables
              {overrideCount > 0 && (
                <span className="text-primary tabular-nums">{overrideCount}</span>
              )}
            </button>
          </Toolbar>
        </div>
        <SidePanel open={panelOpen} title="Variables" onClose={() => setPanelOpen(false)}>
          <VariablesPanel overrides={edited} groups={groups} onChange={setEdited} />
        </SidePanel>
      </div>
    </>
  );
};
