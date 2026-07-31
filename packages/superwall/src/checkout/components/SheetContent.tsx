import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
  type RefObject,
} from "react";

const SheetCardRefContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

export function useSheetCardRef(): RefObject<HTMLDivElement | null> | null {
  return useContext(SheetCardRefContext);
}

interface SheetContentProps {
  open: boolean;
  onClose: () => void;
  largeViewport: boolean;
  children: ReactNode;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button onClick={onClose} className="checkout-close-button" aria-label="Close">
      <svg
        width="18"
        height="18"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
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
}

export function SheetContent({ open, onClose, largeViewport, children }: SheetContentProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);

  const checkScrollable = useCallback(() => {
    if (scrollRef.current) {
      const hasOverflow = scrollRef.current.scrollHeight > scrollRef.current.clientHeight;
      setIsScrollable(hasOverflow);
    }
  }, []);

  useEffect(() => {
    checkScrollable();

    const timeout = setTimeout(checkScrollable, 500);
    const resizeObserver = new ResizeObserver(checkScrollable);
    if (scrollRef.current) {
      resizeObserver.observe(scrollRef.current);
    }

    window.addEventListener("resize", checkScrollable);

    return () => {
      clearTimeout(timeout);
      resizeObserver.disconnect();
      window.removeEventListener("resize", checkScrollable);
    };
  }, [checkScrollable, children]);

  return (
    <SheetCardRefContext.Provider value={cardRef}>
      <div
        className="checkout-sheet-outer"
        data-state={open ? "open" : "closed"}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={cardRef}
          className="checkout-sheet-card"
          data-header="button"
          data-form-inset="true"
        >
          <div className="checkout-header-desktop">
            <CloseButton onClose={onClose} />
          </div>

          <div
            ref={scrollRef}
            className="checkout-scroll-container checkout-sheet-scrollable"
            data-scrollable={isScrollable}
            data-scroll-fade="1"
            style={largeViewport ? { maxHeight: 600 } : undefined}
          >
            {children}
          </div>
        </div>
      </div>
    </SheetCardRefContext.Provider>
  );
}
