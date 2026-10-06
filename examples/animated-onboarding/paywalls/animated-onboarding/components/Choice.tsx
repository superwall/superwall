import type { PropsWithChildren } from "react";

/**
 * One answer. The data attributes are what the motion engine and motion.css
 * key on (engine.md "Mark the moving parts"): `data-flow-option` marks it,
 * `data-selected` the chosen one, `data-committing` the short pause after a
 * tap in which the others step back so the tap is visibly heard before the
 * page moves.
 */
export function Choice({
  selected,
  committing,
  onChoose,
  children,
}: PropsWithChildren<{
  selected: boolean;
  committing: boolean;
  onChoose: () => void;
}>) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className="choice"
      data-flow-option=""
      data-selected={selected ? "" : undefined}
      data-committing={committing ? "" : undefined}
      onClick={onChoose}
    >
      <span className="choice-label">{children}</span>
    </button>
  );
}
