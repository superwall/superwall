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

export type NotificationTheme = "light" | "dark";

const IOS_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const ANDROID_FONT = 'Roboto, "Google Sans", system-ui, sans-serif';

const INSET: Record<NotificationPlatform, number> = { iOS: 8, Android: 12 };

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
  theme,
}: {
  app: NotificationApp;
  size: number;
  radius: number | string;
  theme: NotificationTheme;
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
        background: theme === "dark" ? "#3a3a3c" : "#d1d1d6",
        color: theme === "dark" ? "#fff" : "#3a3a3c",
      }}
    >
      {app.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
};

const IOS_COLORS: Record<
  NotificationTheme,
  { background: string; text: string; secondary: string }
> = {
  light: {
    background: "rgba(246, 246, 246, 0.92)",
    text: "#000",
    secondary: "rgba(60, 60, 67, 0.6)",
  },
  dark: {
    background: "rgba(37, 37, 37, 0.92)",
    text: "#fff",
    secondary: "rgba(235, 235, 245, 0.6)",
  },
};

const IosNotification = ({
  app,
  notification,
  theme,
}: {
  app: NotificationApp;
  notification: NotificationContent;
  theme: NotificationTheme;
}) => {
  const colors = IOS_COLORS[theme];
  return (
    <div
      data-platform="iOS"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 14px",
        borderRadius: 24,
        background: colors.background,
        color: colors.text,
        fontFamily: IOS_FONT,
        fontSize: 15,
        lineHeight: "20px",
        letterSpacing: -0.24,
      }}
    >
      <AppIcon app={app} size={38} radius={9} theme={theme} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span data-part="title" style={{ ...oneLine, flex: 1, fontWeight: 600 }}>
            {notification.title}
          </span>
          <span style={{ flexShrink: 0, fontSize: 13, color: colors.secondary }}>now</span>
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
};

const ANDROID_COLORS: Record<
  NotificationTheme,
  { background: string; text: string; secondary: string }
> = {
  light: { background: "#f4f0f4", text: "#1d1b20", secondary: "#49454f" },
  dark: { background: "#2b2930", text: "#e6e0e9", secondary: "#cac4d0" },
};

const AndroidNotification = ({
  app,
  notification,
  theme,
}: {
  app: NotificationApp;
  notification: NotificationContent;
  theme: NotificationTheme;
}) => {
  const colors = ANDROID_COLORS[theme];
  return (
    <div
      data-platform="Android"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: 16,
        borderRadius: 28,
        background: colors.background,
        color: colors.text,
        fontFamily: ANDROID_FONT,
        fontSize: 14,
        lineHeight: "20px",
      }}
    >
      <AppIcon app={app} size={36} radius="50%" theme={theme} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          data-part="header"
          style={{
            display: "flex",
            gap: 4,
            fontSize: 12,
            lineHeight: "16px",
            color: colors.secondary,
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
        <div data-part="body" style={{ ...clamp(2), color: colors.secondary }}>
          {notification.body}
        </div>
      </div>
    </div>
  );
};

export const NotificationPreview = ({
  platform,
  screenWidth,
  app,
  notification,
  theme = "light",
}: {
  platform: NotificationPlatform;
  screenWidth: number;
  app: NotificationApp;
  notification: NotificationContent;
  theme?: NotificationTheme;
}) => (
  <div
    data-testid="notification-preview"
    style={{ width: notificationWidth(platform, screenWidth) }}
  >
    {platform === "iOS" ? (
      <IosNotification app={app} notification={notification} theme={theme} />
    ) : (
      <AndroidNotification app={app} notification={notification} theme={theme} />
    )}
  </div>
);
