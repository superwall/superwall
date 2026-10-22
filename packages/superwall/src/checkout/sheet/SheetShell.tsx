import * as React from "react";
import { createPortal } from "react-dom";
import { modelOf } from "../../device";
import { deviceStylesOf } from "./device";
import type { StyleWithVariables } from "../../css";
import { useSuperwallSnapshot } from "../../hooks/useSuperwallSnapshot";

type SheetShellProps = React.PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  largeViewport: boolean;
}>;

const FULLSCREEN_STYLES = new Set(["fullscreen", "push", "noAnimation"]);

export const SheetShell = ({ open, onClose, children, largeViewport }: SheetShellProps) => {
  const { config, device } = useSuperwallSnapshot();
  const isFullscreen = FULLSCREEN_STYLES.has(config?.presentation?.style ?? "fullscreen");
  const deviceStyles = deviceStylesOf(modelOf(device) ?? "");
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const [canAnimate, setCanAnimate] = React.useState(false);

  React.useEffect(() => {
    const div = document.createElement("div");
    div.id = "checkout-sheet-portal";
    document.body.appendChild(div);
    setContainer(div);
    return () => {
      document.body.removeChild(div);
    };
  }, []);

  React.useEffect(() => {
    if (!container) {
      setCanAnimate(false);
      return;
    }
    const frame = requestAnimationFrame(() => setCanAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [container]);

  React.useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!container) return null;

  const state = canAnimate && open ? "open" : "closed";
  const style: StyleWithVariables = {
    "--safe-area-offset": deviceStyles.safeAreaOffset,
    "--border-radius": deviceStyles.borderRadius,
  };

  return createPortal(
    <>
      <div className="checkout-backdrop" data-state={state} onClick={onClose} aria-hidden="true" />
      <div
        className="checkout-sheet-wrapper"
        data-state={state}
        data-viewport={largeViewport ? "large" : "small"}
        data-fullscreen={isFullscreen}
        data-variant="embedded"
        role="dialog"
        aria-modal="true"
        style={style}
      >
        {children}
      </div>
    </>,
    container,
  );
};
