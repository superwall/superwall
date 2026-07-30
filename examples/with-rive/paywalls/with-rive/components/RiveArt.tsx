import * as React from "react";
import { Fit, Layout, useRive, useStateMachineInput } from "@rive-app/react-canvas";

/**
 * One Rive file, driven by whatever its state machine exposes.
 *
 * Machines and inputs are named per file — ask the runtime rather than
 * guessing, because naming one that does not exist renders a canvas that
 * simply never responds.
 */
export const RiveArt = ({
  src,
  title,
  hint,
  stateMachine,
  input,
  control,
  height = 220,
  onChange,
}: {
  src: string;
  title: string;
  hint: string;
  stateMachine: string;
  input?: string;
  control: "tap" | "self" | "slider";
  height?: number;
  onChange?: () => void;
}) => {
  const { rive, RiveComponent } = useRive({
    src,
    autoplay: true,
    stateMachines: stateMachine,
    layout: new Layout({ fit: Fit.Cover }),
  });

  const [level, setLevel] = React.useState(0);

  const [on, setOn] = React.useState(false);
  const value = useStateMachineInput(rive, stateMachine, input, control === "tap" ? on : 0);

  React.useEffect(() => {
    if (!rive || control !== "tap") return;
    const probe = (Reflect.get(globalThis, "__sw") ?? {}) as Record<string, unknown>;
    Reflect.set(globalThis, "__sw", probe);
    probe[stateMachine] = {
      inputs: rive
        .stateMachineInputs(stateMachine)
        ?.map((i: { name: string; value: unknown }) => `${i.name}=${String(i.value)}`),
      playing: rive.isPlaying,
    };
  }, [rive, stateMachine, control, on]);

  const set = (next: number) => {
    setLevel(next);
    if (value) value.value = next;
    onChange?.();
  };

  return (
    <section className="art">
      <div className="art-stage" style={{ height }}>
        {control === "tap" ? (
          <button
            type="button"
            className="art-tap"
            aria-label={title}
            onClick={() => {
              if (!value) return;
              const next = !on;
              value.value = next;
              setOn(next);
              onChange?.();
            }}
          >
            <RiveComponent />
          </button>
        ) : (
          <RiveComponent />
        )}
      </div>

      <div className="art-foot">
        <span className="art-title">{title}</span>
        <span className="art-hint">{hint}</span>
      </div>

      {control === "slider" && (
        <input
          className="art-slider"
          type="range"
          min={0}
          max={100}
          value={level}
          aria-label={title}
          onChange={(event) => set(Number(event.target.value))}
        />
      )}
    </section>
  );
};
