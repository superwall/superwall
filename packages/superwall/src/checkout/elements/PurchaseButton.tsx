import * as React from "react";
import { useCheckoutContext } from "./useCheckout";

export type PurchaseButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "onClick"
> & {
  /** Runs before the payment. Call `event.preventDefault()` to stop it. */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

/**
 * A button that pays with the nearest `<Checkout>`'s form. It is disabled
 * until the form can take payment and while a payment is in flight, and sets
 * `data-status` to `useCheckout().status` and `aria-busy` while paying, so it
 * can be styled for each state. Every other prop goes to the `<button>`.
 *
 * ```tsx
 * <PurchaseButton className="cta">Subscribe</PurchaseButton>
 * ```
 */
export const PurchaseButton = ({ disabled, onClick, children, ...props }: PurchaseButtonProps) => {
  const { checkout } = useCheckoutContext("<PurchaseButton>");
  return (
    <button
      {...props}
      type="button"
      disabled={disabled === true || !checkout.canSubmit}
      aria-busy={checkout.status === "paying"}
      data-status={checkout.status}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) void checkout.submit();
      }}
    >
      {children}
    </button>
  );
};
