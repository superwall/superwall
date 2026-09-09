import * as React from "react";

type SheetCardProps = React.PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  largeViewport: boolean;
}>;

const CloseButton = ({ onClose }: { onClose: () => void }) => (
  <button onClick={onClose} className="checkout-close-button" aria-label="Close">
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 4L4 12M4 4L12 12"
        stroke="#6b7280"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </button>
);

const useIsScrollable = (node: HTMLDivElement | null, children: React.ReactNode): boolean => {
  const [isScrollable, setIsScrollable] = React.useState(false);

  React.useEffect(() => {
    if (!node) return;
    const check = () => setIsScrollable(node.scrollHeight > node.clientHeight);
    check();
    const timeout = setTimeout(check, 500);
    const observer = new ResizeObserver(check);
    observer.observe(node);
    window.addEventListener("resize", check);
    return () => {
      clearTimeout(timeout);
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [node, children]);

  return isScrollable;
};

export const SheetCard = ({ open, onClose, largeViewport, children }: SheetCardProps) => {
  const [scrollNode, setScrollNode] = React.useState<HTMLDivElement | null>(null);
  const isScrollable = useIsScrollable(scrollNode, children);

  return (
    <div
      className="checkout-sheet-outer"
      data-state={open ? "open" : "closed"}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="checkout-sheet-card" data-header="button" data-form-inset="true">
        <div className="checkout-header-desktop">
          <CloseButton onClose={onClose} />
        </div>

        <div
          ref={setScrollNode}
          className="checkout-scroll-container checkout-sheet-scrollable"
          data-scrollable={isScrollable}
          data-scroll-fade="1"
          style={largeViewport ? { maxHeight: 600 } : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
