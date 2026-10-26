import * as React from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "../icons";

export type PopupAlign = "start" | "end";

export const useDismiss = (
  refs: readonly React.RefObject<HTMLElement | null>[],
  open: boolean,
  onDismiss: () => void,
) => {
  const dismiss = React.useRef(onDismiss);
  dismiss.current = onDismiss;

  React.useEffect(() => {
    if (!open) return undefined;
    const outside = (event: MouseEvent) => {
      const path = event.composedPath();
      if (!refs.some((ref) => ref.current && path.includes(ref.current))) dismiss.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss.current();
    };
    const focus = (event: FocusEvent) => {
      const path = event.composedPath();
      if (!refs.some((ref) => ref.current && path.includes(ref.current))) dismiss.current();
    };
    // A click into an iframe (the preview, a host's chat) never reaches this
    // window as a mousedown; it blurs the window instead.
    const blur = () => dismiss.current();
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    window.addEventListener("focusin", focus);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("focusin", focus);
      window.removeEventListener("blur", blur);
    };
  }, [refs, open]);
};

export const usePopupAlign = (
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
): PopupAlign => {
  const [align, setAlign] = React.useState<PopupAlign>("start");

  React.useLayoutEffect(() => {
    const anchor = ref.current;
    if (!open || !anchor) return;
    const box = anchor.getBoundingClientRect();
    setAlign(box.left + box.width / 2 > window.innerWidth / 2 ? "end" : "start");
  }, [ref, open]);

  return align;
};

type Placement = Pick<React.CSSProperties, "top" | "bottom" | "left">;

const GUTTER = 12;

const portalRoot = (anchor: HTMLElement | null): Element | ShadowRoot => {
  const studio = anchor?.closest(".sw-studio");
  if (studio) return studio;
  const root = anchor?.getRootNode();
  return root instanceof ShadowRoot ? root : document.body;
};

export const MenuPopup = ({
  popupRef,
  anchor,
  side,
  align,
  className = "",
  children,
}: React.PropsWithChildren<{
  popupRef: React.RefObject<HTMLDivElement | null>;
  anchor: React.RefObject<HTMLElement | null>;
  side: "top" | "bottom";
  align: PopupAlign;
  className?: string;
}>) => {
  const [placement, setPlacement] = React.useState<Placement | undefined>(undefined);

  React.useLayoutEffect(() => {
    const place = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const width = popupRef.current?.offsetWidth ?? 0;
      const desired = align === "end" ? box.right - width : box.left;
      setPlacement({
        ...(side === "top"
          ? { bottom: window.innerHeight - box.top + 4 }
          : { top: box.bottom + 4 }),
        left: Math.max(GUTTER, Math.min(desired, window.innerWidth - GUTTER - width)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, popupRef, side, align]);

  return createPortal(
    <div
      ref={popupRef}
      className={`fixed z-30 flex max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-sm border border-border bg-popover text-foreground ${
        placement ? "" : "invisible"
      } ${className}`}
      style={placement}
      data-menu-popup=""
    >
      {children}
    </div>,
    portalRoot(anchor.current),
  );
};

export const MenuItem = ({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    className={`grid w-full min-w-0 grid-cols-[1fr_0.875rem] items-center gap-2 rounded-sm border border-transparent ps-[calc(--spacing(2.5)-1px)] pe-2 text-left text-sm text-foreground outline-none hover:bg-accent focus-visible:bg-accent ${
      hint ? "py-[calc(--spacing(1.5)-1px)]" : "py-[calc(--spacing(1)-1px)]"
    }`}
    aria-current={selected || undefined}
    onClick={onSelect}
  >
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{label}</span>
      {hint && <span className="truncate text-xs/4 text-fg-tertiary">{hint}</span>}
    </span>
    {selected ? <CheckIcon className="text-primary" /> : <span />}
  </button>
);

export const MenuGroupLabel = ({ children }: React.PropsWithChildren) => (
  <span className="block px-2.5 py-1.5 text-xs font-medium text-fg-tertiary">{children}</span>
);

export const MenuSeparator = () => <span className="mx-2.5 my-1 block h-px bg-border" />;
