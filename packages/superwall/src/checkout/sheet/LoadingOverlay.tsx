import * as React from "react";
import { isLoading, subscribeLoading } from "../loading";

const SPINNER = `<svg class="sw-loader-spinner" width="37" height="37" viewBox="0 0 37 37" aria-hidden="true"><rect class="sw-loader-spoke" x="15.975" y="0.99" width="5.05" height="12.02" rx="2.525" fill="white" transform="rotate(0 18.5 18.5)" style="animation-delay:-0.800s"/><rect class="sw-loader-spoke" x="15.975" y="0.99" width="5.05" height="12.02" rx="2.525" fill="white" transform="rotate(45 18.5 18.5)" style="animation-delay:-0.700s"/><rect class="sw-loader-spoke" x="15.975" y="0.99" width="5.05" height="12.02" rx="2.525" fill="white" transform="rotate(90 18.5 18.5)" style="animation-delay:-0.600s"/><rect class="sw-loader-spoke" x="15.975" y="0.99" width="5.05" height="12.02" rx="2.525" fill="white" transform="rotate(135 18.5 18.5)" style="animation-delay:-0.400s"/><rect class="sw-loader-spoke" x="15.975" y="0.99" width="5.05" height="12.02" rx="2.525" fill="white" transform="rotate(180 18.5 18.5)" style="animation-delay:-0.400s"/><rect class="sw-loader-spoke" x="15.975" y="0.99" width="5.05" height="12.02" rx="2.525" fill="white" transform="rotate(225 18.5 18.5)" style="animation-delay:-0.300s"/><rect class="sw-loader-spoke" x="15.975" y="0.99" width="5.05" height="12.02" rx="2.525" fill="white" transform="rotate(270 18.5 18.5)" style="animation-delay:-0.200s"/><rect class="sw-loader-spoke" x="15.975" y="0.99" width="5.05" height="12.02" rx="2.525" fill="white" transform="rotate(315 18.5 18.5)" style="animation-delay:-0.100s"/></svg>`;

const STYLE = `
.sw-loader {
  position: fixed;
  inset: 0;
  z-index: 999999;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  pointer-events: none;
  visibility: hidden;
  transition: visibility 0s linear 300ms;
}
.sw-loader[data-state="active"] {
  pointer-events: all;
  visibility: visible;
  transition: visibility 0s;
}
.sw-loader-dim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.2575);
  opacity: 0;
  transition: opacity 350ms cubic-bezier(0.42, 0, 0.58, 1);
}
.sw-loader[data-state="active"] .sw-loader-dim {
  opacity: 1;
}
.sw-loader-hud {
  position: relative;
  display: flex;
  padding: 20px;
  width: 77px;
  height: 77px;
  box-sizing: border-box;
  clip-path: path("M 38.5 0 c 17.552 0 26.328 0 32.076 5.314 a 20 20 0 0 1 1.11 1.11 c 5.314 5.748 5.314 14.524 5.314 32.076 L 77 38.5 c 0 17.552 0 26.328 -5.314 32.076 a 20 20 0 0 1 -1.11 1.11 c -5.748 5.314 -14.524 5.314 -32.076 5.314 L 38.5 77 c -17.552 0 -26.328 0 -32.076 -5.314 a 20 20 0 0 1 -1.11 -1.11 c -5.314 -5.748 -5.314 -14.524 -5.314 -32.076 L 0 38.5 c 0 -17.552 0 -26.328 5.314 -32.076 a 20 20 0 0 1 1.11 -1.11 c 5.748 -5.314 14.524 -5.314 32.076 -5.314 Z");
  background-color: rgba(0, 0, 0, 0.2775);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  backdrop-filter: blur(20px) saturate(150%);
  opacity: 0;
  transform: scale(0.05);
  transition: opacity 350ms cubic-bezier(0.35, 0.35, 0.45, 1), transform 700ms cubic-bezier(0.25, 1.05, 0.4, 1);
  transition: opacity 350ms linear(0.0000 0%, 0.0096 5%, 0.0391 10%, 0.0884 15%, 0.1567 20%, 0.2416 25%, 0.3397 30%, 0.4457 35%, 0.5536 40%, 0.6570 45%, 0.7500 50%, 0.8283 55%, 0.8899 60%, 0.9347 65%, 0.9649 70%, 0.9833 75%, 0.9933 80%, 0.9980 85%, 0.9996 90%, 1.0000 95%, 1.0000 100%), transform 700ms linear(0.0000 0%, 0.0519 2.857%, 0.1758 5.714%, 0.3328 8.571%, 0.4954 11.43%, 0.6459 14.29%, 0.7743 17.14%, 0.8764 20%, 0.9523 22.86%, 1.0045 25.71%, 1.0367 28.57%, 1.0533 31.43%, 1.0586 34.29%, 1.0563 37.14%, 1.0494 40%, 1.0403 42.86%, 1.0308 45.71%, 1.0218 48.57%, 1.0141 51.43%, 1.0079 54.29%, 1.0033 57.14%, 1.0000 60%, 0.9980 62.86%, 0.9969 65.71%, 0.9966 68.57%, 0.9967 71.43%, 0.9970 74.29%, 0.9976 77.14%, 0.9981 80%, 0.9987 82.86%, 0.9991 85.71%, 0.9995 88.57%, 0.9998 91.43%, 1.0000 94.29%, 1.0001 97.14%, 1 100%);
  will-change: transform, opacity;
}
.sw-loader[data-state="active"] .sw-loader-hud {
  transition: opacity 350ms cubic-bezier(0.55, 0, 0.65, 1), transform 700ms cubic-bezier(0.25, 1.05, 0.4, 1);
  transition: opacity 350ms linear(0.0000 0%, 0.0000 5%, 0.0004 10%, 0.0020 15%, 0.0067 20%, 0.0167 25%, 0.0351 30%, 0.0653 35%, 0.1101 40%, 0.1717 45%, 0.2500 50%, 0.3430 55%, 0.4464 60%, 0.5543 65%, 0.6603 70%, 0.7584 75%, 0.8433 80%, 0.9116 85%, 0.9609 90%, 0.9904 95%, 1.0000 100%), transform 700ms linear(0.0000 0%, 0.0519 2.857%, 0.1758 5.714%, 0.3328 8.571%, 0.4954 11.43%, 0.6459 14.29%, 0.7743 17.14%, 0.8764 20%, 0.9523 22.86%, 1.0045 25.71%, 1.0367 28.57%, 1.0533 31.43%, 1.0586 34.29%, 1.0563 37.14%, 1.0494 40%, 1.0403 42.86%, 1.0308 45.71%, 1.0218 48.57%, 1.0141 51.43%, 1.0079 54.29%, 1.0033 57.14%, 1.0000 60%, 0.9980 62.86%, 0.9969 65.71%, 0.9966 68.57%, 0.9967 71.43%, 0.9970 74.29%, 0.9976 77.14%, 0.9981 80%, 0.9987 82.86%, 0.9991 85.71%, 0.9995 88.57%, 0.9998 91.43%, 1.0000 94.29%, 1.0001 97.14%, 1 100%);
  opacity: 1;
  transform: none;
}
.sw-loader .sw-loader-spinner {
  display: block;
  transform: translate(-0.667px, -0.667px);
}
.sw-loader .sw-loader-spoke {
  opacity: 0.26;
  animation: sw-loader-spoke 0.8s linear infinite;
  animation-play-state: paused;
}
.sw-loader[data-state="active"] .sw-loader-spoke {
  animation-play-state: running;
}
@keyframes sw-loader-spoke {
  0% { opacity: 0.855; }
  51.25%, 100% { opacity: 0.26; }
}
@media (prefers-reduced-motion: reduce) {
  .sw-loader-hud {
    transform: none;
  }
}
`;

/**
 * The checkout loader, matching the iOS SDK's purchase overlay frame for
 * frame: a 25% dim, and a dark blurred box with the large activity indicator
 * that springs in from a dot while turning half a turn, and springs back out.
 */
export const LoadingOverlay = () => {
  const loading = React.useSyncExternalStore(subscribeLoading, isLoading, () => false);

  return (
    <div
      className="sw-loader"
      data-state={loading ? "active" : "inactive"}
      role="progressbar"
      aria-hidden={!loading}
      aria-busy={loading}
    >
      <style>{STYLE}</style>
      <div className="sw-loader-dim" />
      <div className="sw-loader-hud" dangerouslySetInnerHTML={{ __html: SPINNER }} />
    </div>
  );
};
