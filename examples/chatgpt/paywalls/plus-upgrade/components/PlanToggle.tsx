export type PlanToggleProps<TPlan extends string> = {
  plans: readonly { id: TPlan; label: string }[];
  selected: TPlan;
  onSelect: (plan: TPlan) => void;
};

export const PlanToggle = <TPlan extends string>({
  plans,
  selected,
  onSelect,
}: PlanToggleProps<TPlan>) => (
  <div className="plan-toggle" role="tablist">
    {plans.map((plan) => (
      <button
        key={plan.id}
        type="button"
        role="tab"
        aria-selected={plan.id === selected}
        className={plan.id === selected ? "plan plan-selected" : "plan"}
        onClick={() => onSelect(plan.id)}
      >
        {plan.label}
      </button>
    ))}
  </div>
);
