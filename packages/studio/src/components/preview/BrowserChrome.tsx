import * as React from "react";
import { BROWSER_BAR, type BrowserKind } from "../../lib/devices";

const SITE = "superwall.com";

const BAR_BACKGROUND = "#1c1c1e";

const DARK_GLASS: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.12)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "0.5px solid rgba(255, 255, 255, 0.15)",
  boxShadow: "0 2px 12px rgba(0, 0, 0, 0.1)",
};

const LIGHT_GLASS: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.45)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "0.5px solid rgba(255, 255, 255, 0.5)",
  boxShadow: "0 2px 16px rgba(0, 0, 0, 0.08)",
};

const PHONE_DARK_GLASS: React.CSSProperties = {
  ...DARK_GLASS,
  background: "rgba(60, 60, 64, 0.55)",
};

const Glyph = ({
  size,
  weight = 2,
  className,
  fill = "none",
  children,
}: React.PropsWithChildren<{
  size: number;
  weight?: number;
  className?: string;
  fill?: string;
}>) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={fill === "none" ? "currentColor" : undefined}
    strokeWidth={weight}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`shrink-0 ${className ?? ""}`}
    aria-hidden="true"
  >
    {children}
  </svg>
);

const PageSearch = ({ size }: { size: number }) => (
  <Glyph size={size}>
    <path d="M19.1213 20.1213C17.9497 21.2929 16.0503 21.2929 14.8787 20.1213C13.7071 18.9497 13.7071 17.0503 14.8787 15.8787C16.0503 14.7071 17.9497 14.7071 19.1213 15.8787C20.2929 17.0503 20.2929 18.9497 19.1213 20.1213Z" />
    <path d="M19 11V6C19 4.34315 17.6569 3 16 3H7C5.34315 3 4 4.34315 4 6V18C4 19.6569 5.34315 21 7 21H10.5" />
    <path d="M8 15H9" />
    <path d="M8 7H15" />
    <path d="M8 11H11" />
    <path d="M19.1211 20.1211L20.9998 21.9998" />
  </Glyph>
);

const Reload = ({ size }: { size: number }) => (
  <Glyph size={size} weight={2.5}>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </Glyph>
);

const Back = ({ size, className }: { size: number; className?: string }) => (
  <Glyph size={size} weight={2.5} className={className}>
    <path d="m15 18-6-6 6-6" />
  </Glyph>
);

const Forward = ({ size, className }: { size: number; className?: string }) => (
  <Glyph size={size} weight={2.5} className={className}>
    <path d="m9 18 6-6-6-6" />
  </Glyph>
);

const Sidebar = ({ size }: { size: number }) => (
  <Glyph size={size}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
  </Glyph>
);

const Share = ({ size }: { size: number }) => (
  <Glyph size={size}>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" x2="12" y1="2" y2="15" />
  </Glyph>
);

const NewTab = ({ size }: { size: number }) => (
  <Glyph size={size} weight={2.5}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Glyph>
);

const Tabs = ({ size }: { size: number }) => (
  <Glyph size={size}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Glyph>
);

const More = ({ size }: { size: number }) => (
  <Glyph size={size} fill="currentColor">
    <circle cx="12" cy="5" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="19" r="2" />
  </Glyph>
);

const Pill = ({
  glass,
  height,
  grow = false,
  padding,
  gap,
  children,
}: React.PropsWithChildren<{
  glass: React.CSSProperties;
  height: number;
  grow?: boolean;
  padding: number;
  gap?: number;
}>) => (
  <div
    className={`flex items-center ${grow ? "min-w-0 flex-1" : "shrink-0 justify-center"}`}
    style={{
      height,
      minWidth: height,
      borderRadius: height / 2,
      paddingLeft: padding,
      paddingRight: padding,
      gap,
      ...glass,
    }}
  >
    {children}
  </div>
);

const Address = ({ size, fontSize, color }: { size: number; fontSize: number; color: string }) => (
  <>
    <PageSearch size={size} />
    <span
      className="min-w-0 flex-1 truncate text-center font-medium"
      style={{ color, fontSize, letterSpacing: -0.2 }}
    >
      {SITE}
    </span>
    <Reload size={size - 2} />
  </>
);

const DesktopTopBar = () => (
  <div
    className="absolute inset-x-0 top-0 flex items-center gap-2 text-white"
    data-testid="browser-top-bar"
    style={{
      height: BROWSER_BAR.desktop,
      background: BAR_BACKGROUND,
      paddingLeft: 10,
      paddingRight: 10,
    }}
  >
    <div className="mx-1 flex shrink-0 gap-2">
      <span className="size-3 rounded-full bg-[#FF5F56]" />
      <span className="size-3 rounded-full bg-[#FFBD2E]" />
      <span className="size-3 rounded-full bg-[#27C93F]" />
    </div>
    <Pill glass={DARK_GLASS} height={36} padding={10}>
      <Sidebar size={18} />
    </Pill>
    <Pill glass={DARK_GLASS} height={36} padding={8} gap={4}>
      <Back size={18} />
      <Forward size={18} className="text-white/30" />
    </Pill>
    <Pill glass={DARK_GLASS} height={36} padding={12} grow>
      <Address size={16} fontSize={14} color="rgba(255,255,255,0.85)" />
    </Pill>
    <Pill glass={DARK_GLASS} height={36} padding={10} gap={12}>
      <Share size={16} />
      <NewTab size={16} />
      <Tabs size={16} />
    </Pill>
  </div>
);

const TabletTopBar = ({ height, statusBar }: { height: number; statusBar: number }) => (
  <div
    className="absolute inset-x-0 flex flex-col text-white"
    data-testid="browser-top-bar"
    style={{ top: statusBar, height: height - statusBar, background: BAR_BACKGROUND }}
  >
    <div className="flex flex-1 items-center gap-2 px-3">
      <Pill glass={DARK_GLASS} height={40} padding={0}>
        <Sidebar size={20} />
      </Pill>
      <Pill glass={DARK_GLASS} height={40} padding={0}>
        <Back size={20} />
      </Pill>
      <Pill glass={DARK_GLASS} height={40} padding={12} grow>
        <Address size={18} fontSize={15} color="rgba(255,255,255,0.85)" />
      </Pill>
      <Pill glass={DARK_GLASS} height={40} padding={12} gap={14}>
        <Share size={18} />
        <NewTab size={18} />
        <Tabs size={18} />
      </Pill>
    </div>
  </div>
);

const PhoneBottomBar = ({ dark }: { dark: boolean }) => {
  const glass = dark ? PHONE_DARK_GLASS : LIGHT_GLASS;
  return (
    <div
      className={`absolute inset-x-0 bottom-0 flex justify-center ${dark ? "text-white" : "text-black"}`}
      data-testid="browser-bottom-bar"
      style={{ height: BROWSER_BAR.phone }}
    >
      <div className="flex w-full items-center gap-2.5 px-4" style={{ height: 44, marginTop: 6 }}>
        <Pill glass={glass} height={44} padding={0}>
          <Back size={24} />
        </Pill>
        <Pill glass={glass} height={44} padding={14} grow>
          <Address size={20} fontSize={16} color={dark ? "#ffffff" : "#000000"} />
        </Pill>
        <Pill glass={glass} height={44} padding={0}>
          <More size={20} />
        </Pill>
      </div>
    </div>
  );
};

export const BrowserChrome = ({
  kind,
  top,
  statusBar,
  theme = "light",
}: {
  kind: BrowserKind;
  top: number;
  statusBar: number;
  theme?: "light" | "dark";
}) => (
  <div className="pointer-events-none absolute inset-0" data-testid={`browser-chrome-${kind}`}>
    {kind === "desktop" && <DesktopTopBar />}
    {kind === "tablet" && <TabletTopBar height={top} statusBar={statusBar} />}
    {kind === "phone" && <PhoneBottomBar dark={theme === "dark"} />}
  </div>
);
