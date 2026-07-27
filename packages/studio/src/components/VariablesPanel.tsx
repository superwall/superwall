import type { VariableSpec, VariablesSchema } from "../lib/types";
import { Select, Switch } from "./controls";
import { ResetIcon } from "./icons";

const FieldControl = ({
  name,
  spec,
  value,
  onChange,
}: {
  name: string;
  spec: VariableSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  switch (spec.type) {
    case "boolean":
      return (
        <Switch
          checked={typeof value === "boolean" ? value : spec.default}
          onChange={onChange}
          label={spec.label ?? name}
        />
      );
    case "enum":
      return (
        <Select
          value={typeof value === "string" ? value : spec.default}
          options={spec.values.map((option) => ({ value: option, label: option }))}
          onChange={onChange}
          label={spec.label ?? name}
        />
      );
    case "number":
      return (
        <input
          className="sw-input"
          type="number"
          aria-label={spec.label ?? name}
          value={typeof value === "number" ? value : spec.default}
          min={spec.min}
          max={spec.max}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      );
    case "string":
      return (
        <input
          className="sw-input"
          type="text"
          aria-label={spec.label ?? name}
          value={typeof value === "string" ? value : spec.default}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
};

export const VariablesPanel = ({
  schema,
  values,
  onChange,
}: {
  schema: VariablesSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) => {
  const set = (name: string, value: unknown, spec: VariableSpec) => {
    const next = { ...values };
    if (value === spec.default) {
      delete next[name];
    } else {
      next[name] = value;
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col">
      {Object.entries(schema).map(([name, spec]) => (
        <div key={name} className="flex flex-col items-start gap-2 py-2.5">
          <span className="flex flex-wrap items-center gap-x-2 text-[0.8125rem] font-medium text-cream">
            {spec.label ?? name}
            {spec.label && <span className="sw-tool-label sw-tool-label--key">{name}</span>}
            {name in values && (
              <button
                type="button"
                className="inline-flex text-cream/55 transition-colors hover:text-cream [&_svg]:h-3 [&_svg]:w-3 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.5]"
                aria-label={`Reset ${name}`}
                onClick={() => set(name, spec.default, spec)}
              >
                <ResetIcon />
              </button>
            )}
          </span>
          <FieldControl
            name={name}
            spec={spec}
            value={values[name]}
            onChange={(value) => set(name, value, spec)}
          />
        </div>
      ))}
    </div>
  );
};
