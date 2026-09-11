export const MissingProducts = ({
  paywall,
  missing,
  onDismiss,
}: {
  paywall: string;
  missing: { reference: string; identifier: string }[];
  onDismiss: () => void;
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6"
    role="dialog"
    aria-modal="true"
    aria-labelledby="sw-missing-products"
  >
    <div className="bg-panel flex w-full max-w-md flex-col gap-4 rounded border border-cream/20 p-5">
      <div className="flex flex-col gap-1.5">
        <span id="sw-missing-products" className="text-[0.9375rem] font-medium text-cream">
          {missing.length === 1 ? "A product is missing" : `${missing.length} products are missing`}
        </span>
        <span className="text-[0.8125rem] leading-relaxed text-cream/60">
          {`${paywall} declares ${missing.length === 1 ? "a product" : "products"} Superwall has no record of. Every variable on ${missing.length === 1 ? "it" : "them"} will be undefined here and on device.`}
        </span>
      </div>

      <ul className="flex flex-col gap-1.5 border-y border-cream/10 py-3">
        {missing.map((entry) => (
          <li key={entry.reference} className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[11px] text-cream/70">{entry.reference}</span>
            <span className="truncate font-mono text-[11px] text-cream/40">{entry.identifier}</span>
          </li>
        ))}
      </ul>

      <span className="text-xs text-cream/45">
        Add {missing.length === 1 ? "it" : "them"} in the Superwall dashboard, or point the config
        at{missing.length === 1 ? " a product" : " products"} that exists. Pushing is refused until
        then.
      </span>

      <button type="button" className="sw-btn sw-btn--primary self-end" onClick={onDismiss}>
        View anyway
      </button>
    </div>
  </div>
);
