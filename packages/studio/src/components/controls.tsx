import * as React from "react";
import { ChevronsUpDownIcon } from "./icons";

export type ControlSize = "default" | "sm";

export const ControlSizeContext = React.createContext<ControlSize>("default");

type Box = { left: number; width: number };

export const Segmented = <TValue extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: TValue;
  options: readonly { value: TValue; label: React.ReactNode; name?: string }[];
  onChange: (value: TValue) => void;
  label: string;
}) => {
  const segments = React.useRef(new Map<TValue, HTMLButtonElement>());
  const [box, setBox] = React.useState<Box | undefined>(undefined);

  React.useLayoutEffect(() => {
    const segment = segments.current.get(value);
    setBox(segment ? { left: segment.offsetLeft, width: segment.offsetWidth } : undefined);
  }, [value, options]);

  return (
    <div
      className="flex h-8 flex-none rounded-[calc(var(--radius-sm)+3px)] border border-border p-0.5"
      role="group"
      aria-label={label}
    >
      <div className="relative flex gap-0.5">
        {box && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 rounded-sm bg-primary/10 transition-[left,width] duration-move ease-out motion-reduce:transition-none"
            style={box}
          />
        )}
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => {
                if (node) segments.current.set(option.value, node);
                else segments.current.delete(option.value);
              }}
              type="button"
              aria-pressed={selected}
              aria-label={option.name}
              className={`relative z-10 flex h-6.5 min-w-6.5 items-center justify-center gap-2 rounded-sm border border-transparent px-[calc(--spacing(2.5)-1px)] text-sm whitespace-nowrap transition-colors duration-hover focus-visible:border-primary ${
                selected
                  ? "text-primary"
                  : "text-fg-tertiary hover:text-foreground [&:not(:hover)>svg]:icon-tertiary"
              }`}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const Select = ({
  value,
  options,
  onChange,
  label,
  size,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
  size?: ControlSize;
}) => {
  const contextSize = React.useContext(ControlSizeContext);
  const small = (size ?? contextSize) === "sm";
  return (
    <span className="relative inline-flex flex-none">
      <select
        className={`sw-select bg-card bg-linear-to-b from-transparent to-transparent transition-[border-color,--tw-gradient-from,--tw-gradient-to] duration-hover hover:not-focus-visible:border-foreground/20 hover:from-foreground/3 hover:to-foreground/3 ${
          small ? "sw-select--sm" : ""
        }`}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronsUpDownIcon
        className={`icon-tertiary pointer-events-none absolute top-1/2 -translate-y-1/2 ${
          small ? "right-[calc(--spacing(2.5)-1px)]" : "right-[calc(--spacing(3)-1px)]"
        }`}
      />
    </span>
  );
};

export const Switch = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`inline-flex h-4.5 w-7.5 flex-none items-center rounded-full border border-transparent transition-colors duration-hover ${
      checked
        ? "bg-primary focus-visible:border-foreground"
        : "bg-secondary focus-visible:border-primary"
    }`}
    onClick={() => onChange(!checked)}
  >
    <span
      aria-hidden="true"
      className={`block size-4 rounded-full transition-[translate,background-color] duration-hover ${
        checked ? "translate-x-3 bg-primary-foreground" : "bg-fg-tertiary"
      }`}
    />
  </button>
);

const BADGE: Record<"outline" | "success", string> = {
  outline: "border-border text-fg-tertiary",
  success: "border-transparent bg-success/16 text-success-foreground",
};

export const Badge = ({
  variant,
  children,
}: React.PropsWithChildren<{ variant: keyof typeof BADGE }>) => (
  <span
    className={`inline-flex h-5 min-w-5 flex-none items-center justify-center rounded-sm border px-[calc(--spacing(1.5)-1px)] text-[0.75rem]/4 font-medium tabular-nums whitespace-nowrap ${BADGE[variant]}`}
  >
    {children}
  </span>
);
