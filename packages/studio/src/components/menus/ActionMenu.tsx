import * as React from "react";
import { ChevronDownIcon, SpinnerIcon } from "../icons";
import { Tooltip } from "../Tooltip";
import { MenuItem, MenuPopup, useDismiss } from "./Menu";
import {
  ACTION_STEPS,
  STEP_LABELS,
  type StudioActionStep,
  type StudioStepState,
} from "../../lib/steps";
import { type StudioActionName } from "../../lib/surfaces";

const ACTIONS: readonly { name: StudioActionName; label: string; hint: string }[] = [
  { name: "push", label: "Push", hint: "New version, nothing live changes" },
  { name: "promote", label: "Promote", hint: "Make the latest push live" },
  { name: "publish", label: "Publish", hint: "Push and make it live" },
];

const labelFor = (name: StudioActionName): string =>
  ACTIONS.find((action) => action.name === name)?.label ?? name;

const runningLabel: Record<StudioActionName, string> = {
  push: "Pushing…",
  publish: "Publishing…",
  promote: "Promoting…",
};

export type ActionProgress = {
  action: StudioActionName;
  steps: Partial<Record<StudioActionStep, StudioStepState>>;
  error?: string;
};

const DOT: Record<StudioStepState, string> = {
  active: "bg-primary motion-safe:animate-pulse",
  done: "bg-primary",
  failed: "bg-destructive",
  pending: "bg-fg-muted",
};

const ProgressPanel = ({ progress }: { progress: ActionProgress }) => {
  const steps = ACTION_STEPS[progress.action];
  const done = steps.filter((step) => progress.steps[step] === "done").length;
  const failed = progress.error !== undefined;

  return (
    <div className="flex w-72 max-w-full flex-col">
      <div className="flex flex-col gap-2 p-3">
        <span className="-mt-1 text-sm font-medium">
          {failed
            ? `${labelFor(progress.action)} failed`
            : done === steps.length
              ? `${labelFor(progress.action)} complete`
              : runningLabel[progress.action]}
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
                {STEP_LABELS[step]}
              </span>
              <span className={`size-2 flex-none rounded-full ${DOT[state]}`} />
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

export const ActionMenu = ({
  progress,
  blocked,
  onRun,
  onBlocked,
}: {
  progress: ActionProgress | undefined;
  blocked?: string;
  onRun: (action: StudioActionName) => void;
  onBlocked?: () => void;
}) => {
  const [selected, setSelected] = React.useState<StudioActionName>("push");
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const stopped = blocked !== undefined;
  const busy =
    progress !== undefined &&
    progress.error === undefined &&
    ACTION_STEPS[progress.action].some((step) => progress.steps[step] !== "done");
  const showPanel = progress !== undefined;

  const popupRef = React.useRef<HTMLDivElement>(null);
  const dismissRefs = React.useMemo(() => [menuRef, popupRef], []);
  useDismiss(dismissRefs, open, () => setOpen(false));

  return (
    <div className="relative flex" ref={menuRef}>
      <Tooltip hint={blocked}>
        <span className="flex">
          <button
            type="button"
            className="sw-btn sw-btn--sm sw-btn--primary rounded-e-none border-e-0"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => (stopped ? onBlocked?.() : onRun(selected))}
          >
            {busy && <SpinnerIcon />}
            {busy ? runningLabel[progress.action] : labelFor(selected)}
          </button>
          <span aria-hidden="true" className="w-px bg-primary-foreground/24" />
          <button
            type="button"
            className="sw-btn sw-btn--sm sw-btn--icon sw-btn--primary rounded-s-none border-s-0"
            aria-label="Choose action"
            aria-expanded={open}
            aria-busy={busy || undefined}
            disabled={busy}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDownIcon />
          </button>
        </span>
      </Tooltip>

      {(showPanel || open) && (
        <MenuPopup popupRef={popupRef} anchor={menuRef} side="bottom" align="end">
          {showPanel ? (
            <ProgressPanel progress={progress} />
          ) : (
            <div className="flex w-max flex-col p-1">
              {ACTIONS.map((action) => (
                <MenuItem
                  key={action.name}
                  label={action.label}
                  hint={action.hint}
                  selected={action.name === selected}
                  onSelect={() => {
                    setSelected(action.name);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          )}
        </MenuPopup>
      )}
    </div>
  );
};
