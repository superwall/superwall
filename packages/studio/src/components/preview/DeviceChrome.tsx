import type { DeviceChromeSpec } from "../../lib/devices";

const CellularIcon = () => (
  <svg width="19" height="12" viewBox="0 0 19 12" fill="currentColor" aria-hidden="true">
    <rect x="0" y="7.5" width="3.5" height="4.5" rx="1" />
    <rect x="5" y="5" width="3.5" height="7" rx="1" />
    <rect x="10" y="2.5" width="3.5" height="9.5" rx="1" />
    <rect x="15" y="0" width="3.5" height="12" rx="1" />
  </svg>
);

const BatteryIcon = () => (
  <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true">
    <rect
      x="0.5"
      y="0.5"
      width="23"
      height="12"
      rx="3.8"
      fill="none"
      stroke="currentColor"
      strokeOpacity="0.35"
    />
    <path d="M25 4.5v4a2.17 2.17 0 0 0 0-4Z" fill="currentColor" fillOpacity="0.4" />
    <rect x="2" y="2" width="20" height="9" rx="2.5" fill="currentColor" />
  </svg>
);

const StatusCluster = () => (
  <span className="flex items-center gap-[7px]">
    <CellularIcon />
    <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.02em" }}>SW</span>
    <BatteryIcon />
  </span>
);

/**
 * Drawn in device pixels over the preview iframe; the frame scales the whole
 * layer. Everything is pointer-events-none so taps land on the paywall.
 */
export const DeviceChrome = ({
  spec,
  width,
  height,
  landscape,
  theme,
}: {
  spec: DeviceChromeSpec;
  width: number;
  height: number;
  landscape: boolean;
  theme: "light" | "dark";
}) => {
  const ink = theme === "dark" ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.95)";
  const sidePadding = Math.max(28, spec.radius * 0.6);

  return (
    <div
      className="pointer-events-none absolute inset-0 select-none"
      style={{ width, height, color: ink }}
      data-testid="device-chrome"
    >
      {!landscape && (
        <div
          className="absolute inset-x-0 top-0 flex items-center justify-between"
          style={{
            height: spec.statusBarHeight,
            paddingLeft: sidePadding,
            paddingRight: sidePadding,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.2px",
          }}
        >
          <span>9:41</span>
          <StatusCluster />
        </div>
      )}

      {spec.cutout === "island" &&
        (landscape ? (
          <div
            className="absolute rounded-full bg-black"
            style={{ left: 12, top: (height - 124) / 2, width: 36, height: 124 }}
          />
        ) : (
          <div
            className="absolute rounded-full bg-black"
            style={{ left: (width - 124) / 2, top: 12, width: 124, height: 36 }}
          />
        ))}

      {spec.cutout === "punch" &&
        (landscape ? (
          <div
            className="absolute rounded-full bg-black"
            style={{ left: 16, top: (height - 13) / 2, width: 13, height: 13 }}
          />
        ) : (
          <div
            className="absolute rounded-full bg-black"
            style={{ left: (width - 13) / 2, top: 15, width: 13, height: 13 }}
          />
        ))}

      {spec.homeIndicator && (
        <div
          className="absolute rounded-full"
          style={{
            width: Math.round(Math.min(width, height) * 0.36),
            height: 5,
            left: "50%",
            transform: "translateX(-50%)",
            bottom: 8,
            background: ink,
            opacity: 0.9,
          }}
        />
      )}
    </div>
  );
};
