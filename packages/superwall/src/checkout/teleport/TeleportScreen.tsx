import * as React from "react";
import { createPortal } from "react-dom";
import { teleportOf } from "@superwall/runtime";
import { asString } from "../api/decode";
import { useTeleport } from "../../hooks/useTeleport";
import { useSuperwallSnapshot } from "../../hooks/useSuperwallSnapshot";
import { useSuperwallSession } from "../../provider/context";
import { teleportCopyFor } from "./copy";
import { readTeleportBoot } from "./boot";
import { teleportFor } from "./flow";
import { FOOTER_BRAND, STATUS_MARKS, SUPERWALL_LOGO_PATHS, TELEPORT_SCREEN_CSS } from "./styles";

const SPINNER_RADIUS = 14;
const SPINNER_CIRCUMFERENCE = 2 * Math.PI * SPINNER_RADIUS;
const POWERED_BY_HREF = "https://superwall.com?ref=teleport";

type Action = { label: string; kind: "primary" | "tinted" | "secondary"; onClick: () => void };

type ScreenProps = {
  surface: "overlay" | "page";
  title: string;
  body: string;
  dir: "ltr" | "rtl";
  spinner?: boolean;
  success?: boolean;
  footer?: string;
  actions: readonly Action[];
};

const Ring = ({ className, arcLength }: { className?: string; arcLength?: number }) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
    <circle
      cx="16"
      cy="16"
      r={SPINNER_RADIUS}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeDasharray={
        arcLength === undefined ? undefined : `${arcLength} ${SPINNER_CIRCUMFERENCE}`
      }
    />
  </svg>
);

const Footer = ({ label }: { label: string }) => {
  const [before, ...after] = label.split(FOOTER_BRAND);
  return (
    <a
      className="sw-teleport-footer"
      href={POWERED_BY_HREF}
      target="_blank"
      rel="noopener noreferrer"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {Object.entries(SUPERWALL_LOGO_PATHS).map(([letter, d]) => (
          <path
            key={letter}
            className={`sw-teleport-footer-logo-${letter}`}
            d={d}
            fill="currentColor"
          />
        ))}
      </svg>
      <span className="sw-teleport-footer-text">
        {before}
        <span className="sw-teleport-footer-brand">{FOOTER_BRAND}</span>
        {after.join(FOOTER_BRAND)}
      </span>
    </a>
  );
};

const Screen = ({ surface, title, body, dir, spinner, success, footer, actions }: ScreenProps) => {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return createPortal(
    <div
      className="sw-teleport"
      data-surface={surface}
      data-state={open ? "open" : "closed"}
      data-footer={footer === undefined ? undefined : ""}
      dir={dir}
      role={surface === "overlay" ? "dialog" : "status"}
      aria-modal={surface === "overlay" ? true : undefined}
      aria-label={title}
    >
      <style>{TELEPORT_SCREEN_CSS}</style>
      <div className="sw-teleport-content">
        <div className="sw-teleport-message">
          {spinner ? (
            <div className="sw-teleport-spinner" role="progressbar" aria-label={title}>
              <Ring className="sw-teleport-track" />
              <div className="sw-teleport-orbit">
                <div className="sw-teleport-arc">
                  <Ring arcLength={SPINNER_CIRCUMFERENCE * 0.28} />
                </div>
              </div>
            </div>
          ) : null}
          {success ? (
            <div className="sw-teleport-status" data-status="success">
              <svg
                viewBox="0 0 32 32"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle
                  className="sw-teleport-status-ring"
                  cx="16"
                  cy="16"
                  r={SPINNER_RADIUS}
                  transform="rotate(-90 16 16)"
                />
                {STATUS_MARKS.success.map((d) => (
                  <path key={d} className="sw-teleport-status-mark" d={d} pathLength={1} />
                ))}
              </svg>
            </div>
          ) : null}
          <h1 className="sw-teleport-title">{title}</h1>
          <p className="sw-teleport-body">{body}</p>
        </div>
        {actions.length > 0 ? (
          <div className="sw-teleport-actions">
            {actions.map((action) => (
              <button
                key={action.kind}
                type="button"
                className={`sw-teleport-button sw-teleport-${action.kind}`}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {footer === undefined ? null : <Footer label={footer} />}
    </div>,
    document.body,
  );
};

/**
 * Superwall's own teleport screens: the waiting screen over the paywall in
 * the app while the shopper is in the browser, and "You're all set" on the
 * web once they paid. The build mounts it for a paywall with `teleport`; a
 * paywall drawing its own sets `teleport.overlay: false` and reads
 * `useTeleport()`.
 */
export const TeleportScreen = () => {
  const session = useSuperwallSession();
  const { config, device } = useSuperwallSnapshot();
  const teleport = useTeleport();
  const settings = teleportOf(config?.teleport);
  const copy = teleportCopyFor(asString(device.deviceLocale) || undefined);
  const dir = copy.dir ?? "ltr";

  const tapped = (action: () => void) => () => {
    session.postMessage({ event_name: "haptic_feedback", haptic_type: "light" });
    action();
  };

  if (settings?.overlay && teleport.waitingScreen) {
    return (
      <Screen
        surface="overlay"
        title={copy.waiting.title}
        body={copy.waiting.body}
        dir={dir}
        spinner
        actions={[
          { label: copy.waiting.continue, kind: "primary", onClick: tapped(teleport.reopen) },
          ...(teleport.fallback === undefined
            ? []
            : [
                {
                  label: copy.waiting.payInApp,
                  kind: "tinted" as const,
                  onClick: tapped(teleport.payInApp),
                },
              ]),
          { label: copy.waiting.cancel, kind: "secondary", onClick: tapped(teleport.cancel) },
        ]}
      />
    );
  }

  if (teleport.onWeb && teleport.completed) {
    const returns = readTeleportBoot()?.returnUrl !== undefined;
    return (
      <Screen
        surface="page"
        title={copy.success.title}
        body={returns ? copy.success.body : copy.success.bodyNoReturn}
        dir={dir}
        success
        footer={copy.success.poweredBy}
        actions={
          returns
            ? [
                {
                  label: copy.success.action,
                  kind: "primary",
                  onClick: () => teleportFor(session).returnToApp("purchased"),
                },
              ]
            : []
        }
      />
    );
  }

  return null;
};
