export const PlanOption = ({
  name,
  price,
  caption,
  badge,
  selected,
  onSelect,
}: {
  name: string;
  price?: string;
  caption?: string;
  badge?: string;
  selected: boolean;
  onSelect: () => void;
}) => (
  <button type="button" className="plan" role="radio" aria-checked={selected} onClick={onSelect}>
    <span className="plan-name">
      {name}
      {badge && <span className="plan-badge">{badge}</span>}
    </span>
    <span className="plan-price">
      {price}
      {caption && <span className="plan-caption">{caption}</span>}
    </span>
  </button>
);
