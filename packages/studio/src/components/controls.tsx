import * as React from "react";

export const Segmented = <TValue extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: TValue;
  options: readonly { value: TValue; label: React.ReactNode }[];
  onChange: (value: TValue) => void;
  label: string;
}) => (
  <div className="sw-segmented" role="group" aria-label={label}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={option.value === value}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const Select = ({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
}) => (
  <select
    className="sw-select"
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
);

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
    className="sw-switch"
    onClick={() => onChange(!checked)}
  />
);
