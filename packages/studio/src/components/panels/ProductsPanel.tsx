import * as React from "react";
import { EmptyState } from "../EmptyState";
import { InlineCode } from "../InlineCode";
import { AlertTriangleIcon, CartIcon, CheckIcon, CopyIcon } from "../icons";
import { productSummary } from "../../lib/products";
import type { Samples } from "../../lib/contract";

type SlotState =
  | { kind: "ok"; variables: Record<string, unknown> }
  | { kind: "missing" }
  | { kind: "unchecked" }
  | { kind: "loading" };

const slotState = (identifier: string, samples: Samples): SlotState => {
  if (samples.unreachable) return { kind: "unchecked" };
  if (!samples.products) return { kind: "loading" };
  const variables = samples.products[identifier];
  return variables === undefined ? { kind: "missing" } : { kind: "ok", variables };
};

const CopyButton = ({ value, label }: { value: string; label: string }) => {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="sw-btn sw-btn--sm sw-btn--icon sw-btn--ghost shrink-0"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
    </button>
  );
};

const Flag = ({ tone, children }: React.PropsWithChildren<{ tone: "destructive" | "warning" }>) => (
  <span
    className={`flex shrink-0 items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs ${
      tone === "destructive"
        ? "bg-destructive/16 text-destructive-foreground"
        : "bg-warning/8 text-warning-foreground"
    }`}
  >
    <AlertTriangleIcon className="size-3" />
    {children}
  </span>
);

const Slot = ({
  reference,
  identifier,
  state,
}: {
  reference: string;
  identifier: string;
  state: SlotState;
}) => {
  const summary = state.kind === "ok" ? productSummary(state.variables) : undefined;

  return (
    <section
      aria-label={reference}
      className="flex flex-col gap-2 border-b border-border px-4 py-3.5"
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{reference}</span>
        {state.kind === "missing" && <Flag tone="destructive">Not in Superwall</Flag>}
        {state.kind === "unchecked" && <Flag tone="warning">Couldn’t check</Flag>}
      </div>
      <div className="-my-1 flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate font-mono text-xs text-fg-secondary" title={identifier}>
          {identifier}
        </span>
        <CopyButton value={identifier} label={`${reference} identifier`} />
      </div>
      {state.kind === "loading" && <span className="text-xs text-fg-tertiary">Checking…</span>}
      {state.kind === "missing" && (
        <p className="m-0 text-xs text-fg-secondary">
          Superwall has no product with this identifier. Its variables are undefined here and on
          device.
        </p>
      )}
      {summary &&
        (summary.price ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-medium tabular-nums">{summary.price}</span>
            {summary.equivalents.length > 0 && (
              <span className="text-xs text-fg-tertiary tabular-nums">
                {summary.equivalents.join(" · ")}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-fg-tertiary">No price on record</span>
        ))}
      {summary?.trial && (
        <span className="self-start rounded-xs bg-success/12 px-1.5 py-0.5 text-xs text-success-foreground">
          {summary.trial}
        </span>
      )}
    </section>
  );
};

export const ProductsPanel = ({
  products,
  samples,
}: {
  products: Record<string, string> | undefined;
  samples: Samples;
}) => {
  const slots = Object.entries(products ?? {});

  if (slots.length === 0) {
    return (
      <EmptyState
        icon={<CartIcon />}
        title="No products"
        description={
          <>
            This paywall sells nothing yet. Add a <InlineCode>products</InlineCode> map to{" "}
            <InlineCode>config.ts</InlineCode>, like{" "}
            <InlineCode>{`products: { primary: "pro_year" }`}</InlineCode>.
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col">
      {samples.unreachable && (
        <div
          role="status"
          className="flex items-start gap-2 border-b border-border bg-warning/8 px-4 py-2.5 text-xs text-warning-foreground"
        >
          <AlertTriangleIcon className="mt-0.5 size-3 flex-none" />
          <span className="min-w-0">Couldn’t check these products · {samples.unreachable}</span>
        </div>
      )}
      {slots.map(([reference, identifier]) => (
        <Slot
          key={reference}
          reference={reference}
          identifier={identifier}
          state={slotState(identifier, samples)}
        />
      ))}
      <p className="m-0 px-4 py-3.5 text-xs text-fg-tertiary">
        Products change in <InlineCode>config.ts</InlineCode>. Push and promote to ship the change.
      </p>
    </div>
  );
};
