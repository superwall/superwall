import * as React from "react";
import { InlineCode } from "../InlineCode";
import { AlertTriangleIcon, CartIcon, CheckIcon, CopyIcon } from "../icons";
import { MenuPopup, useDismiss, usePopupAlign } from "./Menu";
import { productSummary } from "../../lib/products";
import type { Samples } from "../../lib/contract";

type SlotState =
  | { kind: "ok"; variables: Record<string, unknown> }
  | { kind: "missing" }
  | { kind: "unchecked" }
  | { kind: "loading" };

const slotState = (identifier: string, samples: Samples, pending: boolean): SlotState => {
  if (samples.unreachable) return { kind: "unchecked" };
  if (!samples.products) return { kind: pending ? "loading" : "unchecked" };
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
    className={`ms-auto flex shrink-0 items-center gap-1 text-xs ${
      tone === "destructive" ? "text-destructive-foreground" : "text-warning-foreground"
    }`}
  >
    <AlertTriangleIcon className="size-3" />
    {children}
  </span>
);

const detail = (state: SlotState): string | undefined => {
  if (state.kind === "loading") return "Checking…";
  if (state.kind === "missing") return "No product with this identifier";
  if (state.kind === "unchecked") return undefined;
  const summary = productSummary(state.variables);
  if (!summary.price) return "No price on record";
  return summary.trial ? `${summary.price} · ${summary.trial}` : summary.price;
};

const Slot = ({
  reference,
  identifier,
  state,
}: {
  reference: string;
  identifier: string;
  state: SlotState;
}) => {
  const line = detail(state);
  const equivalents = state.kind === "ok" ? productSummary(state.variables).equivalents : [];

  return (
    <section aria-label={reference} className="flex flex-col gap-1.5">
      <div className="flex min-h-5 items-center gap-2 px-0.5">
        <span className="truncate text-sm font-medium">{reference}</span>
        {state.kind === "missing" && <Flag tone="destructive">Not in Superwall</Flag>}
        {state.kind === "unchecked" && <Flag tone="warning">Couldn’t check</Flag>}
      </div>
      <div
        className={`flex min-h-11 items-center gap-1 rounded-sm border bg-background py-1.5 ps-2.5 pe-1 ${
          state.kind === "missing" ? "border-destructive/40" : "border-border"
        }`}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-xs/5" title={identifier}>
            {identifier}
          </span>
          {line && (
            <span className="truncate text-xs/4 text-fg-secondary tabular-nums">{line}</span>
          )}
          {equivalents.length > 0 && (
            <span className="truncate text-xs/4 text-fg-tertiary tabular-nums">
              {equivalents.join(" · ")}
            </span>
          )}
        </div>
        <CopyButton value={identifier} label={`${reference} identifier`} />
      </div>
    </section>
  );
};

export const ProductsMenu = ({
  products,
  samples,
  pending = false,
}: {
  products: Record<string, string> | undefined;
  samples: Samples;
  pending?: boolean;
}) => {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const dismissRefs = React.useMemo(() => [menuRef, popupRef], []);
  useDismiss(dismissRefs, open, () => setOpen(false));
  const align = usePopupAlign(menuRef, open);

  const slots = Object.entries(products ?? {}).map(([reference, identifier]) => ({
    reference,
    identifier,
    state: slotState(identifier, samples, pending),
  }));
  const missing = slots.filter((slot) => slot.state.kind === "missing").length;
  const flagged = slots.length > 0 && (Boolean(samples.unreachable) || missing > 0);
  const label = flagged
    ? samples.unreachable
      ? "Products, couldn’t check"
      : `Products, ${missing} missing`
    : slots.length > 0
      ? `Products, ${slots.length}`
      : "Products";

  return (
    <div className="relative flex" ref={menuRef}>
      <button
        type="button"
        className="sw-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <CartIcon />
        Products
        {flagged ? (
          <AlertTriangleIcon className="text-warning" />
        ) : (
          slots.length > 0 && <span className="text-fg-tertiary tabular-nums">{slots.length}</span>
        )}
      </button>

      {open && (
        <MenuPopup popupRef={popupRef} anchor={menuRef} side="top" align={align} className="w-80">
          <div role="dialog" aria-label="Products" className="flex min-h-0 flex-col">
            {slots.length > 0 && !samples.unreachable && !samples.products && !pending && (
              <p
                role="status"
                className="m-0 border-b border-border px-3 py-2 text-xs text-fg-tertiary"
              >
                No product catalog to check these against.
              </p>
            )}
            {slots.length === 0 ? (
              <p className="m-0 px-3 py-3 text-sm text-fg-secondary">
                This paywall sells nothing yet.
              </p>
            ) : (
              <div className="flex max-h-96 scroll-fade flex-col gap-3 overflow-y-auto p-3">
                {slots.map((slot) => (
                  <Slot key={slot.reference} {...slot} />
                ))}
              </div>
            )}
            <p className="m-0 border-t border-border px-3 py-2.5 text-xs text-fg-tertiary">
              {slots.length === 0 ? (
                <>
                  Add <InlineCode>{`products: { primary: "pro_year" }`}</InlineCode> to{" "}
                  <InlineCode>config.ts</InlineCode>.
                </>
              ) : (
                <>
                  Products change in <InlineCode>config.ts</InlineCode>. Push and promote to ship.
                </>
              )}
            </p>
          </div>
        </MenuPopup>
      )}
    </div>
  );
};
