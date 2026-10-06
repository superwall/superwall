import { Dialog } from "../Dialog";

export const MissingProducts = ({
  paywall,
  missing,
  onDismiss,
}: {
  paywall: string;
  missing: { reference: string; identifier: string }[];
  onDismiss: () => void;
}) => (
  <Dialog
    title={missing.length === 1 ? "A product is missing" : `${missing.length} products are missing`}
    description={`${paywall} declares ${missing.length === 1 ? "a product" : "products"} Superwall has no record of. Every variable on ${missing.length === 1 ? "it" : "them"} will be undefined here and on device.`}
    onClose={onDismiss}
    footer={
      <button type="button" className="sw-btn sw-btn--primary" onClick={onDismiss}>
        View anyway
      </button>
    }
  >
    <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-sm border border-border p-0">
      {missing.map((entry) => (
        <li
          key={entry.reference}
          className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm"
        >
          <span className="truncate">{entry.reference}</span>
          <span className="truncate text-fg-tertiary tabular-nums">{entry.identifier}</span>
        </li>
      ))}
    </ul>
    <p className="m-0 text-sm text-fg-secondary">
      Add {missing.length === 1 ? "it" : "them"} in the Superwall dashboard, or point the config at
      {missing.length === 1 ? " a product" : " products"} that exists. Pushing is refused until
      then.
    </p>
  </Dialog>
);
