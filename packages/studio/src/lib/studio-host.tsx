import * as React from "react";

/**
 * How the studio is being viewed.
 *
 * - `local` — served by `superwall dev` on a desktop browser.
 * - `device` — the same server, opened on a phone: trimmed chrome, and every
 *   card is a real link because touch navigation is browser navigation.
 * - `hosted` — embedded in the dashboard, where the studio is one route inside
 *   a larger app rather than the whole page.
 */
export type StudioMode = "local" | "device" | "hosted";

/**
 * Where the logo goes.
 *
 * Two mechanisms for one destination: `href` is what the browser opens on a
 * middle or modified click, and `navigate` is what a plain click runs in-app.
 * A hosted studio needs both — following the href there would reload the whole
 * dashboard.
 */
export type StudioHome = {
  href: string;
  navigate: () => void;
};

export type StudioHostValue = {
  mode: StudioMode;
  home: StudioHome;
};

const StudioHostContext = React.createContext<StudioHostValue | undefined>(undefined);

const useStudioHost = (): StudioHostValue => {
  const value = React.useContext(StudioHostContext);
  if (!value) {
    throw new Error("Studio components must be rendered inside <StudioHostProvider>.");
  }
  return value;
};

export const StudioHostProvider = ({
  mode,
  home,
  children,
}: {
  mode: StudioMode;
  home: StudioHome;
  children: React.ReactNode;
}) => {
  const { href, navigate } = home;
  const value = React.useMemo<StudioHostValue>(
    () => ({ mode, home: { href, navigate } }),
    [mode, href, navigate],
  );
  return <StudioHostContext.Provider value={value}>{children}</StudioHostContext.Provider>;
};

export const useStudioMode = (): StudioMode => useStudioHost().mode;

export const useStudioHome = (): StudioHome => useStudioHost().home;
