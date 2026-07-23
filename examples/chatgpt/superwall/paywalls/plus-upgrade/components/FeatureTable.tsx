const Check = ({ muted = false }: { muted?: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-label="included">
    <path
      d="M4 10.5 8.5 15 16 5.5"
      stroke={muted ? "#9ca3af" : "#5D5CDE"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Dash = () => <span className="feature-dash" aria-label="not included" />;

export type FeatureRow = {
  label: string;
  free: boolean;
};

export type FeatureTableProps = {
  featuresLabel: string;
  freeLabel: string;
  planLabel: string;
  rows: readonly FeatureRow[];
};

export const FeatureTable = ({ featuresLabel, freeLabel, planLabel, rows }: FeatureTableProps) => (
  <div className="feature-table">
    <div className="feature-row feature-header">
      <span>{featuresLabel}</span>
      <span className="feature-col">{freeLabel}</span>
      <span className="feature-col feature-col-plan">{planLabel}</span>
    </div>
    {rows.map((row) => (
      <div key={row.label} className="feature-row">
        <span>{row.label}</span>
        <span className="feature-col">{row.free ? <Check muted /> : <Dash />}</span>
        <span className="feature-col">
          <Check />
        </span>
      </div>
    ))}
  </div>
);
