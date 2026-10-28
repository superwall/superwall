import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Dialog } from "./Dialog";
import { ExternalIcon, QrCodeIcon, SpinnerIcon } from "./icons";
import { useStudioMode } from "../lib/studio-host";
import { devServerLink, readScheme, storeScheme } from "../lib/scheme";
import type { StudioSource, StudioSurface } from "../lib/surfaces";

type LinkState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "unavailable"; reason: string };

const askForScheme = (initial: string): string | undefined => {
  const answer = window.prompt("Your app’s URL scheme, so this can open it:", initial);
  const trimmed = answer?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  storeScheme(trimmed);
  return trimmed;
};

export const PreviewOnDevice = ({
  source,
  surface,
  autoOpen = false,
  pushFirst,
  disabled = false,
  request,
  onOpenChange,
}: {
  source: StudioSource;
  surface: StudioSurface;
  /** Opens with the dialog showing, as a push made for it lands here. */
  autoOpen?: boolean;
  /**
   * Set while the surface is not in the account yet: a device has nothing to
   * open, so Preview asks to push it first and this runs the push.
   */
  pushFirst?: () => void;
  disabled?: boolean;
  /** A host's ask (`previewOnDevice`), handled as a click on Preview or a close; a new `key` asks again. */
  request?: { open: boolean; key: number };
  /** Whether the dialog, or the push it asks for first, is showing. */
  onOpenChange?: (open: boolean) => void;
}) => {
  const hosted = useStudioMode() === "hosted";
  const [open, setOpen] = React.useState(autoOpen);
  const [confirming, setConfirming] = React.useState(false);
  const showing = open || confirming;
  React.useEffect(() => onOpenChange?.(showing), [showing]);
  React.useEffect(() => {
    if (!request || request.key === 0) return;
    if (!request.open) {
      setOpen(false);
      setConfirming(false);
    } else if (pushFirst) setConfirming(true);
    else setOpen(true);
    // Only a new ask acts; `pushFirst` changes every render.
  }, [request?.key]);
  const [scheme, setScheme] = React.useState(() => readScheme() ?? source.scheme);
  const [link, setLink] = React.useState<LinkState>({ status: "loading" });

  React.useEffect(() => {
    if (!open) return;

    // A hosted studio has no dev server to point at, so the host mints a link
    // that opens the live paywall through the SDK's debugger instead.
    if (hosted) {
      const build = source.previewLink;
      if (build === undefined) {
        setLink({ status: "unavailable", reason: "This studio can’t open paywalls on a device." });
        return;
      }
      let cancelled = false;
      setLink({ status: "loading" });
      build(surface).then(
        (url) => {
          if (!cancelled) setLink({ status: "ready", url });
        },
        (error: unknown) => {
          if (!cancelled) setLink({ status: "unavailable", reason: String(error) });
        },
      );
      return () => {
        cancelled = true;
      };
    }

    if (scheme === undefined) {
      setLink({ status: "unavailable", reason: "Set your app’s URL scheme to build a link." });
      return;
    }

    setLink({
      status: "ready",
      url: devServerLink(scheme, source.networkOrigin ?? window.location.origin, surface.id),
    });
  }, [open, hosted, scheme, source, surface]);

  return (
    <>
      <button
        className="sw-btn sw-btn--sm max-sm:w-7 max-sm:px-0"
        type="button"
        aria-label="Preview"
        disabled={disabled}
        onClick={() => (pushFirst ? setConfirming(true) : setOpen(true))}
      >
        <QrCodeIcon />
        <span className="max-sm:hidden">Preview</span>
      </button>

      {confirming && pushFirst && (
        <Dialog
          title="Push this paywall first?"
          description="Previewing on a device needs a saved version. This pushes it as a draft: a new version, nothing live changes."
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="sw-btn" type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                className="sw-btn sw-btn--primary"
                type="button"
                onClick={() => {
                  setConfirming(false);
                  pushFirst();
                }}
              >
                Push and preview
              </button>
            </>
          }
        />
      )}

      {open && (
        <Dialog
          title="Preview on a device"
          description={
            hosted
              ? "Scan with the device that has your app installed. It opens the live paywall in the SDK’s debugger."
              : "Scan with the device that has your app installed. It opens this paywall against this machine’s dev server."
          }
          onClose={() => setOpen(false)}
          footer={
            <>
              {!hosted && (
                <button
                  className="sw-btn"
                  type="button"
                  onClick={() => {
                    const answer = askForScheme(scheme ?? "");
                    if (answer !== undefined) setScheme(answer);
                  }}
                >
                  {scheme === undefined ? "Set URL scheme" : "Edit URL scheme"}
                </button>
              )}
              {link.status === "ready" && (
                <a
                  className="sw-btn sw-btn--primary sm:ml-auto"
                  href={link.url}
                  {...(hosted ? { target: "_blank", rel: "noreferrer" } : {})}
                >
                  <ExternalIcon />
                  {hosted ? "Open preview" : "Open in app"}
                </a>
              )}
            </>
          }
        >
          <div className="flex flex-col items-center gap-3 py-2">
            {link.status === "ready" ? (
              <>
                <div className="rounded-sm bg-foreground p-3">
                  <QRCodeSVG value={link.url} size={192} />
                </div>
                {!hosted && (
                  <span className="max-w-full text-center text-xs break-all text-fg-tertiary">
                    {link.url}
                  </span>
                )}
              </>
            ) : (
              <div className="flex size-54 flex-none flex-col items-center justify-center gap-2 rounded-sm border border-border bg-card px-6 text-center text-xs text-fg-tertiary">
                {link.status === "loading" ? (
                  <>
                    <SpinnerIcon />
                    Building a link…
                  </>
                ) : (
                  link.reason
                )}
              </div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
};
