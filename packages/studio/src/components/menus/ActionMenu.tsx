import * as React from "react";
import { ChevronDownIcon, ChevronsUpDownIcon, SpinnerIcon } from "../icons";
import { timeAgo } from "../../lib/time";
import { Tooltip } from "../Tooltip";
import { MenuItem, MenuPopup, useDismiss } from "./Menu";
import {
  ACTION_STEPS,
  stepLabel,
  type StudioActionStep,
  type StudioStepState,
} from "../../lib/steps";
import {
  PROMOTION_LABEL,
  promotionBlocker,
  promotionDirection,
  promotionHint,
  type Promotion,
  type PromotionDirection,
} from "../../lib/promotion";
import { type StudioActionName, type StudioVersion } from "../../lib/surfaces";

const HINTS: Record<Exclude<StudioActionName, "promote">, string> = {
  push: "New version, nothing live changes",
  publish: "Push and make it live",
};

const labelFor = (name: StudioActionName, direction: PromotionDirection): string =>
  name === "push" ? "Push" : name === "publish" ? "Publish" : PROMOTION_LABEL[direction].label;

const runningLabel = (name: StudioActionName, direction: PromotionDirection): string =>
  name === "push"
    ? "Pushing…"
    : name === "publish"
      ? "Publishing…"
      : PROMOTION_LABEL[direction].running;

export type ActionProgress = {
  action: StudioActionName;
  steps: Partial<Record<StudioActionStep, StudioStepState>>;
  error?: string;
};

const DOT: Record<Exclude<StudioStepState, "active">, string> = {
  done: "bg-primary",
  failed: "bg-destructive",
  pending: "bg-fg-muted",
};

const ProgressPanel = ({
  progress,
  direction,
  target,
}: {
  progress: ActionProgress;
  direction: PromotionDirection;
  target: number | undefined;
}) => {
  const steps = ACTION_STEPS[progress.action];
  const done = steps.filter((step) => progress.steps[step] === "done").length;
  const failed = progress.error !== undefined;

  return (
    <div className="flex w-72 max-w-full flex-col">
      <div className="flex flex-col gap-2 p-3">
        <span className="-mt-1 text-sm font-medium">
          {failed
            ? `${labelFor(progress.action, direction)} failed`
            : done === steps.length
              ? `${labelFor(progress.action, direction)} complete`
              : runningLabel(progress.action, direction)}
        </span>
        <span className="block h-1 w-full overflow-hidden rounded-sm bg-muted">
          <span
            className={`block h-full transition-[width] duration-move ease-out ${failed ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col border-t border-border p-1">
        {steps.map((step, index) => {
          const state = progress.steps[step] ?? "pending";
          return (
            <li key={step} className="flex items-center gap-2 px-2.5 py-1">
              <span className="w-4 text-xs text-fg-muted tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className={`flex-1 text-sm ${state === "pending" ? "text-fg-tertiary" : "text-foreground"}`}
              >
                {stepLabel(step, progress.action === "promote" ? direction : "promote", target)}
              </span>
              {state === "active" ? (
                <span className="flex size-4 flex-none items-center justify-center text-primary">
                  <SpinnerIcon />
                </span>
              ) : (
                <span className={`size-2 flex-none rounded-full ${DOT[state]}`} />
              )}
            </li>
          );
        })}
      </ul>
      {progress.error && (
        <div
          className="border-t border-border p-3 text-xs whitespace-pre-wrap text-destructive-foreground"
          role="alert"
        >
          {progress.error}
        </div>
      )}
    </div>
  );
};

const versionLabel = (entry: StudioVersion): string =>
  `v${entry.version}${entry.live ? " · Live" : ""}`;

const versionHint = (entry: StudioVersion): string => {
  if (entry.live) return "What SDKs receive today";
  const ago = entry.pushedAt ? timeAgo(entry.pushedAt) : undefined;
  return ago ? `Pushed ${ago}` : "Pushed snapshot";
};

const SEGMENT = "sw-btn sw-btn--sm sw-btn--primary";

const VersionMenu = ({
  versions,
  target,
  disabled,
  onPick,
}: {
  versions: readonly StudioVersion[];
  target: number | undefined;
  disabled: boolean;
  onPick: (version: number) => void;
}) => {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const dismissRefs = React.useMemo(() => [menuRef, popupRef], []);
  useDismiss(dismissRefs, open, () => setOpen(false));
  const current = versions.find((entry) => entry.version === target);

  return (
    <div className="relative flex" ref={menuRef}>
      <button
        type="button"
        className="sw-btn sw-btn--sm"
        aria-label="Version"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {current ? versionLabel(current) : `v${target}`}
        <ChevronsUpDownIcon className="icon-tertiary" />
      </button>
      {open && (
        <MenuPopup popupRef={popupRef} anchor={menuRef} side="bottom" align="end" className="w-56">
          <div className="flex max-h-64 scroll-fade flex-col overflow-y-auto p-1" data-menu-list="">
            {versions.map((entry) => (
              <MenuItem
                key={entry.version}
                label={versionLabel(entry)}
                hint={versionHint(entry)}
                selected={entry.version === target}
                onSelect={() => {
                  setOpen(false);
                  onPick(entry.version);
                }}
              />
            ))}
          </div>
        </MenuPopup>
      )}
    </div>
  );
};

export const ActionMenu = ({
  offered,
  promotion,
  progress,
  blocked,
  onRun,
  onBlocked,
}: {
  offered: readonly StudioActionName[];
  promotion: Promotion;
  progress: ActionProgress | undefined;
  blocked?: string;
  onRun: (action: StudioActionName) => void;
  onBlocked?: () => void;
}) => {
  const [selected, setSelected] = React.useState<StudioActionName>(offered[0] ?? "push");
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const direction = promotionDirection(promotion.target, promotion.live);
  const [run, setRun] = React.useState({ direction, target: promotion.target });
  const ordered = [...promotion.versions].sort((a, b) => b.version - a.version);
  const pick = promotion.pick;
  const picker = pick !== undefined && ordered.length > 0;
  const chooser = offered.length > 1;

  const stop = selected === "promote" ? promotionBlocker(promotion) : blocked;
  const stopped = stop !== undefined;
  const busy =
    progress !== undefined &&
    progress.error === undefined &&
    ACTION_STEPS[progress.action].some((step) => progress.steps[step] !== "done");
  // The progress panel opens when a run starts or fails, and closes like any
  // popover; the button or chevron brings it back while the run is on screen.
  const [panelOpen, setPanelOpen] = React.useState(false);
  const runKey = progress ? `${progress.action}:${progress.error !== undefined}` : undefined;
  React.useEffect(() => setPanelOpen(runKey !== undefined), [runKey]);
  const showPanel = progress !== undefined && panelOpen;

  const popupRef = React.useRef<HTMLDivElement>(null);
  const dismissRefs = React.useMemo(() => [menuRef, popupRef], []);
  useDismiss(dismissRefs, open || showPanel, () => {
    setOpen(false);
    setPanelOpen(false);
  });

  const start = () => {
    if (busy) {
      setPanelOpen((value) => !value);
      return;
    }
    if (stopped) {
      if (selected !== "promote") onBlocked?.();
      return;
    }
    setRun({ direction, target: promotion.target });
    setOpen(false);
    setPanelOpen(true);
    onRun(selected);
  };

  const toggleChooser = () => {
    if (busy) {
      setPanelOpen((value) => !value);
      return;
    }
    setPanelOpen(false);
    setOpen((value) => showPanel || !value);
  };

  const choose = (action: StudioActionName) => {
    setSelected(action);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      {picker && (
        <VersionMenu
          versions={ordered}
          target={promotion.target}
          disabled={busy}
          onPick={(version) => {
            pick(version);
            if (offered.includes("promote")) setSelected("promote");
          }}
        />
      )}
      <div className="relative flex" ref={menuRef}>
        <Tooltip hint={stop}>
          <span className="flex">
            <button
              type="button"
              className={`${SEGMENT} ${chooser ? "rounded-e-none border-e-0" : ""}`}
              disabled={!busy && stopped && selected === "promote"}
              aria-busy={busy || undefined}
              aria-expanded={progress ? showPanel : undefined}
              onClick={start}
            >
              {busy && <SpinnerIcon />}
              {busy ? runningLabel(progress.action, run.direction) : labelFor(selected, direction)}
            </button>
            {chooser && (
              <>
                <span aria-hidden="true" className="w-px bg-primary-foreground/24" />
                <button
                  type="button"
                  className={`${SEGMENT} sw-btn--icon rounded-s-none border-s-0`}
                  aria-label="Choose action"
                  aria-expanded={open || showPanel}
                  aria-busy={busy || undefined}
                  onClick={toggleChooser}
                >
                  <ChevronDownIcon />
                </button>
              </>
            )}
          </span>
        </Tooltip>

        {(showPanel || open) && (
          <MenuPopup popupRef={popupRef} anchor={menuRef} side="bottom" align="end">
            {showPanel ? (
              <ProgressPanel progress={progress} direction={run.direction} target={run.target} />
            ) : (
              <div className="flex w-max min-w-56 flex-col p-1">
                {offered.map((action) => (
                  <MenuItem
                    key={action}
                    label={labelFor(action, direction)}
                    hint={action === "promote" ? promotionHint(promotion) : HINTS[action]}
                    selected={action === selected}
                    onSelect={() => choose(action)}
                  />
                ))}
              </div>
            )}
          </MenuPopup>
        )}
      </div>
    </div>
  );
};
