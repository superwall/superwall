export type ChoiceProps = {
  label: string;
  selected: boolean;
  onSelect: () => void;
};

export const Choice = ({ label, selected, onSelect }: ChoiceProps) => (
  <button
    type="button"
    className={selected ? "choice choice-selected" : "choice"}
    aria-pressed={selected}
    onClick={onSelect}
  >
    {label}
  </button>
);
