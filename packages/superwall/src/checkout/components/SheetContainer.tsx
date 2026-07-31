import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePresentation } from "../state/CheckoutContext";
import { getDeviceStyles } from "../utils/deviceStyles";

interface SheetContainerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  largeViewport: boolean;
}

export function SheetContainer({ open, onClose, children, largeViewport }: SheetContainerProps) {
  const { isFullscreen, deviceModel } = usePresentation();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [canAnimate, setCanAnimate] = useState(false);

  const deviceStyles = getDeviceStyles(deviceModel);

  useEffect(() => {
    const div = document.createElement("div");
    div.id = "checkout-sheet-portal";
    document.body.appendChild(div);
    setContainer(div);

    return () => {
      document.body.removeChild(div);
    };
  }, []);

  useEffect(() => {
    if (!container) {
      setCanAnimate(false);
      return;
    }
    const frame = requestAnimationFrame(() => setCanAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [container]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  if (!container) {
    return null;
  }

  const effectiveOpen = canAnimate && open;

  return createPortal(
    <>
      <div
        className="checkout-backdrop"
        data-state={effectiveOpen ? "open" : "closed"}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="checkout-sheet-wrapper"
        data-state={effectiveOpen ? "open" : "closed"}
        data-viewport={largeViewport ? "large" : "small"}
        data-fullscreen={isFullscreen}
        data-variant="embedded"
        role="dialog"
        aria-modal="true"
        style={
          {
            "--safe-area-offset": deviceStyles.safeAreaOffset,
            "--border-radius": deviceStyles.borderRadius,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </>,
    container,
  ) as ReactNode;
}
