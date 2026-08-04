import * as React from "react";
import { ChevronDownIcon } from "./icons";
import {
  ACTION_STEPS,
  STEP_LABELS,
  type StudioActionName,
  type StudioActionStep,
  type StudioStepState,
} from "../lib/types";

const ACTIONS: readonly { name: StudioActionName; label: string; hint: string }[] = [
  { name: "push", label: "Push", hint: "New version, nothing live changes" },
  { name: "publish", label: "Publish", hint: "Push and make it live" },
  { name: "promote", label: "Promote", hint: "Make the latest push live" },
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

const StepGlyph = ({ state }: { state: StudioStepState }) => {
  if (state === "active") return <span className="bg-accent h-2 w-2 animate-pulse" />;
  if (state === "done") return <span className="bg-accent h-2 w-2" />;
  if (state === "failed") return <span className="bg-red h-2 w-2" />;
  return <span className="bg-cream/55 h-2 w-2" />;
};

const ProgressPanel = ({ progress }: { progress: ActionProgress }) => {
  const steps = ACTION_STEPS[progress.action];
  const done = steps.filter((step) => progress.steps[step] === "done").length;
  const failed = progress.error !== undefined;

  return (
    <div className="w-64">
      <div className="border-b border-cream/10 px-3 py-2.5">
        <div className="text-[0.8125rem] font-medium">
          {failed
            ? `${labelFor(progress.action)} failed`
            : done === steps.length
              ? `${labelFor(progress.action)} complete`
              : runningLabel[progress.action]}
        </div>
        <div className="mt-2 h-0.5 w-full bg-cream/10">
          <div
            className={`h-full transition-[width] duration-300 ease-out ${failed ? "bg-red" : "bg-accent"}`}
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
      </div>
      <ul className="m-0 list-none px-3 py-2">
        {steps.map((step, index) => {
          const state = progress.steps[step] ?? "pending";
          return (
            <li key={step} className="flex items-center gap-2.5 py-1.5">
              <span
                className={`w-4 font-mono text-[0.625rem] tabular-nums ${
                  state === "pending" ? "text-cream/25" : "text-cream/55"
                }`}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className={`flex-1 text-[0.8125rem] ${
                  state === "pending" ? "text-cream/40" : "text-cream"
                }`}
              >
                {STEP_LABELS[step]}
              </span>
              <StepGlyph state={state} />
            </li>
          );
        })}
      </ul>
      {progress.error && (
        <div className="text-red border-t border-cream/10 px-3 py-2.5 text-xs whitespace-pre-wrap">
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

  React.useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative flex" ref={menuRef}>
      <button
        type="button"
        className="sw-btn sw-btn--primary disabled:cursor-not-allowed disabled:opacity-40"
        disabled={busy}
        title={blocked}
        onClick={() => (stopped ? onBlocked?.() : onRun(selected))}
      >
        {busy ? runningLabel[progress.action] : labelFor(selected)}
      </button>
      <button
        type="button"
        className="sw-btn sw-btn--primary -ml-px w-6 !px-0 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Choose action"
        aria-expanded={open}
        title={blocked}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDownIcon />
      </button>

      {(showPanel || open) && (
        <div className="bg-bar absolute top-full right-0 z-20 mt-1 border border-cream/20">
          {showPanel ? (
            <ProgressPanel progress={progress} />
          ) : (
            <div className="w-64">
              {ACTIONS.map((action) => (
                <button
                  key={action.name}
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-cream/5"
                  onClick={() => {
                    setSelected(action.name);
                    setOpen(false);
                  }}
                >
                  <span className="text-[0.8125rem] font-medium">{action.label}</span>
                  <span className="text-xs text-cream/55">{action.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
