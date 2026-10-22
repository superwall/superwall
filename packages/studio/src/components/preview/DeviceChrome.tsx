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

type Point = { x: number; y: number };

export type DuoLayout = {
  corners: [number, number, number, number];
  camera?: Point;
  clock?: Point;
  ring?: Point;
};

/** Where iPhone Duo's camera and status sit, in the points UIKit reports on the iOS 27.1 simulator. */
export const duoLayout = (duo: "closed" | "open", landscape: boolean): DuoLayout => {
  if (duo === "closed") {
    return landscape
      ? { corners: [8, 8, 59, 59], camera: { x: 630.5, y: 418.5 } }
      : {
          corners: [8, 59, 59, 8],
          camera: { x: 418.2, y: 47.8 },
          clock: { x: 417.7, y: 92.7 },
          ring: { x: 418, y: 130 },
        };
  }
  return landscape
    ? { corners: [55, 55, 55, 55], clock: { x: 903, y: 39.7 }, ring: { x: 903, y: 77 } }
    : { corners: [55, 55, 55, 55], clock: { x: 574.6, y: 47.6 }, ring: { x: 621, y: 48 } };
};

const at = (point: Point) => ({
  position: "absolute" as const,
  left: point.x,
  top: point.y,
  transform: "translate(-50%, -50%)",
});

const DuoStatusRing = () => {
  const dots = [64, 77, 90, 103, 116].map((deg) => {
    const r = (deg * Math.PI) / 180;
    return { cx: 20 + 17 * Math.cos(r), cy: 20 + 17 * Math.sin(r) };
  });
  return (
    <svg width={40} height={40} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M8.1 32.2 A17 17 0 1 1 31.9 32.2"
        stroke="#fff"
        strokeWidth={3}
        strokeLinecap="round"
      />
      {dots.map((dot) => (
        <circle key={dot.cx} cx={dot.cx} cy={dot.cy} r={1.2} fill="#fff" opacity={0.6} />
      ))}
      <path
        d="M13.5 18.2a9.2 9.2 0 0 1 13 0"
        stroke="#fff"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path
        d="M16.3 21a5.2 5.2 0 0 1 7.4 0"
        stroke="#fff"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <circle cx={20} cy={24.2} r={1.8} fill="#fff" />
    </svg>
  );
};

/** The paywall runs under all of it, as on the device: nothing here is opaque but the camera. */
const DuoChrome = ({ layout }: { layout: DuoLayout }) => (
  <>
    {(layout.clock || layout.ring) && (
      <div
        className="absolute inset-0"
        style={{ mixBlendMode: "difference" }}
        data-testid="duo-status"
      >
        {layout.clock && (
          <span
            className="leading-none"
            style={{
              ...at(layout.clock),
              fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: -0.2,
              color: "#fff",
            }}
          >
            9:41
          </span>
        )}
        {layout.ring && (
          <div style={at(layout.ring)}>
            <DuoStatusRing />
          </div>
        )}
      </div>
    )}
    {layout.camera && (
      <div
        className="absolute rounded-full"
        data-testid="duo-camera"
        style={{
          ...at(layout.camera),
          width: 37,
          height: 37,
          background: "radial-gradient(circle at 50% 50%, #1b2733 0 18%, #05070a 30% 100%)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
        }}
      />
    )}
  </>
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
      {spec.duo && <DuoChrome layout={duoLayout(spec.duo, landscape)} />}

      {!landscape && !spec.duo && (
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
