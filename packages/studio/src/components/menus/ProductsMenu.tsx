import * as React from "react";
import { InlineCode } from "../InlineCode";
import {
  AlertTriangleIcon,
  AppleIcon,
  BoxIcon,
  CartIcon,
  CheckIcon,
  CopyIcon,
  GooglePlayIcon,
  StripeIcon,
  type IconComponent,
} from "../icons";
import { MenuPopup, useDismiss, usePopupAlign } from "./Menu";
import { productSummary } from "../../lib/products";
import type { ProductListing, ProductStore, Samples } from "../../lib/contract";

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

const STORES: Record<ProductStore, { label: string; icon: IconComponent }> = {
  "app-store": { label: "App Store", icon: AppleIcon },
  "play-store": { label: "Google Play", icon: GooglePlayIcon },
  stripe: { label: "Stripe", icon: StripeIcon },
  custom: { label: "Custom", icon: BoxIcon },
};

const storesOf = (listing: ProductListing | undefined) =>
  (listing?.stores ?? []).flatMap((store) => (Object.hasOwn(STORES, store) ? [STORES[store]] : []));

const StoreTile = ({
  state,
  listing,
}: {
  state: SlotState;
  listing: ProductListing | undefined;
}) => {
  const [store] = storesOf(listing);
  const Mark = state.kind === "missing" ? AlertTriangleIcon : (store?.icon ?? CartIcon);
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-sm border ${
        state.kind === "missing"
          ? "border-destructive/40 text-destructive-foreground"
          : "border-border bg-muted text-fg-secondary"
      }`}
    >
      <Mark />
    </span>
  );
};

const Price = ({ state }: { state: SlotState }) => {
  if (state.kind !== "ok") return null;
  const summary = productSummary(state.variables);
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5">
      {summary.price ? (
        <span className="text-sm/5 font-medium tabular-nums">{summary.price}</span>
      ) : (
        <span className="text-sm/5 text-fg-tertiary">No price on record</span>
      )}
      {summary.trial && <span className="text-xs/4 text-fg-secondary">{summary.trial}</span>}
    </div>
  );
};

const STATUS: Record<Exclude<SlotState["kind"], "ok">, { text: string; tone: string }> = {
  loading: { text: "Checking…", tone: "text-fg-tertiary" },
  missing: { text: "Not in Superwall", tone: "text-destructive-foreground" },
  unchecked: { text: "Couldn’t check", tone: "text-warning-foreground" },
};

const Identifier = ({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className: string;
}) => {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={`group/id flex min-w-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-mono hover:text-foreground ${className}`}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      title={value}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <CheckIcon className="size-3 text-success" />
      ) : (
        <CopyIcon className="size-3 opacity-0 group-hover/id:opacity-100 group-focus-visible/id:opacity-100" />
      )}
    </button>
  );
};

const Slot = ({
  reference,
  identifier,
  state,
  listing,
}: {
  reference: string;
  identifier: string;
  state: SlotState;
  listing: ProductListing | undefined;
}) => {
  const stores = storesOf(listing)
    .map((store) => store.label)
    .join(" + ");
  const name = listing?.name && listing.name !== identifier ? listing.name : undefined;
  const status = state.kind === "ok" ? undefined : STATUS[state.kind];
  const copy = `${reference} identifier`;

  return (
    <section aria-label={reference} className="flex items-center gap-3 px-3 py-2.5">
      <StoreTile state={state} listing={listing} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 text-sm/5">
          {name ? (
            <span className="truncate font-medium">{name}</span>
          ) : (
            <Identifier value={identifier} label={copy} className="text-[0.8125rem]" />
          )}
          <span className="sw-chip h-4.5 shrink-0 font-mono text-[0.6875rem] font-normal text-fg-secondary">
            {reference}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs/4 text-fg-tertiary">
          {status && <span className={`shrink-0 ${status.tone}`}>{status.text}</span>}
          {stores && <span className="shrink-0">{stores}</span>}
          {stores && name && <span aria-hidden="true">·</span>}
          {name && <Identifier value={identifier} label={copy} className="text-xs" />}
        </div>
      </div>
      <Price state={state} />
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
        <MenuPopup popupRef={popupRef} anchor={menuRef} side="top" align={align} className="w-104">
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
              <div className="flex max-h-96 scroll-fade flex-col divide-y divide-border overflow-y-auto">
                {slots.map((slot) => (
                  <Slot
                    key={slot.reference}
                    {...slot}
                    listing={samples.catalog?.[slot.identifier]}
                  />
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
