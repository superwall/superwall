import * as React from "react";

export type NotificationPlatform = "iOS" | "Android";

export type NotificationContent = {
  title: string;
  subtitle?: string;
  body: string;
};

export type NotificationApp = {
  name: string;
  iconUrl?: string;
};

const IOS_FONT = 'system-ui, BlinkMacSystemFont, -apple-system, "SF Pro Text", sans-serif';
const ANDROID_FONT = '"Google Sans Text", Roboto, system-ui, sans-serif';

const INSET: Record<NotificationPlatform, number> = { iOS: 14, Android: 12 };

const WALLPAPER: Record<NotificationPlatform, string> = {
  iOS: "linear-gradient(160deg, #262a45 0%, #121423 55%, #1b1f33 100%)",
  Android: "linear-gradient(160deg, #1d1b26 0%, #0f0e14 60%, #17151d 100%)",
};

export const notificationWidth = (platform: NotificationPlatform, screenWidth: number): number =>
  Math.max(0, screenWidth - INSET[platform] * 2);

const clamp = (lines: number): React.CSSProperties => ({
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: lines,
  overflow: "hidden",
  overflowWrap: "anywhere",
});

const oneLine: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

const AppIcon = ({
  app,
  size,
  radius,
}: {
  app: NotificationApp;
  size: number;
  radius: number | string;
}) => {
  const [failed, setFailed] = React.useState(false);
  const shape: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
  };
  if (app.iconUrl && !failed) {
    return (
      <img
        src={app.iconUrl}
        alt=""
        data-testid="notification-icon"
        style={{ ...shape, objectFit: "cover" }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-testid="notification-icon-fallback"
      style={{
        ...shape,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.45,
        fontWeight: 600,
        background: "linear-gradient(180deg, #4a4a50 0%, #2c2c30 100%)",
        color: "#fff",
      }}
    >
      {app.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
};

const IosNotification = ({
  app,
  notification,
}: {
  app: NotificationApp;
  notification: NotificationContent;
}) => (
  <div
    data-platform="iOS"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11.5px 17px 12.7px 14px",
      borderRadius: 24,
      background: "rgba(66, 66, 74, 0.5)",
      backdropFilter: "blur(24px) saturate(1.6)",
      WebkitBackdropFilter: "blur(24px) saturate(1.6)",
      boxShadow: "inset 0 0 0 0.5px rgba(255, 255, 255, 0.16)",
      color: "rgba(255, 255, 255, 0.93)",
      fontFamily: IOS_FONT,
      fontSize: 15,
      lineHeight: "17.9px",
    }}
  >
    <AppIcon app={app} size={38} radius={8} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span data-part="title" style={{ ...oneLine, flex: 1, fontWeight: 600 }}>
          {notification.title}
        </span>
        <span style={{ flexShrink: 0, fontSize: 13, color: "rgba(255, 255, 255, 0.6)" }}>now</span>
      </div>
      {notification.subtitle && (
        <div data-part="subtitle" style={{ ...oneLine, fontWeight: 600 }}>
          {notification.subtitle}
        </div>
      )}
      <div data-part="body" style={clamp(4)}>
        {notification.body}
      </div>
    </div>
  </div>
);

const AndroidNotification = ({
  app,
  notification,
}: {
  app: NotificationApp;
  notification: NotificationContent;
}) => (
  <div
    data-platform="Android"
    style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
      padding: 16,
      borderRadius: 28,
      background: "#2b2930",
      color: "#e6e0e9",
      fontFamily: ANDROID_FONT,
      fontSize: 14,
      lineHeight: "20px",
    }}
  >
    <AppIcon app={app} size={36} radius="50%" />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        data-part="header"
        style={{
          display: "flex",
          gap: 4,
          fontSize: 12,
          lineHeight: "16px",
          color: "#cac4d0",
        }}
      >
        <span style={{ ...oneLine, flexShrink: 0, maxWidth: "50%" }}>{app.name}</span>
        {notification.subtitle && (
          <>
            <span aria-hidden="true">•</span>
            <span data-part="subtitle" style={oneLine}>
              {notification.subtitle}
            </span>
          </>
        )}
        <span aria-hidden="true">•</span>
        <span style={{ flexShrink: 0 }}>now</span>
      </div>
      <div data-part="title" style={{ ...oneLine, marginTop: 2, fontWeight: 500 }}>
        {notification.title}
      </div>
      <div data-part="body" style={{ ...clamp(2), color: "#cac4d0" }}>
        {notification.body}
      </div>
    </div>
  </div>
);

export const NotificationPreview = ({
  platform,
  screenWidth,
  app,
  notification,
}: {
  platform: NotificationPlatform;
  screenWidth: number;
  app: NotificationApp;
  notification: NotificationContent;
}) => (
  <div
    data-testid="notification-preview"
    className="rounded-sm"
    style={{
      width: screenWidth,
      padding: `14px ${INSET[platform]}px`,
      background: WALLPAPER[platform],
      colorScheme: "dark",
    }}
  >
    <div data-part="card" style={{ width: notificationWidth(platform, screenWidth) }}>
      {platform === "iOS" ? (
        <IosNotification app={app} notification={notification} />
      ) : (
        <AndroidNotification app={app} notification={notification} />
      )}
    </div>
  </div>
);
