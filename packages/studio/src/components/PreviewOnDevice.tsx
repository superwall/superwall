import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import { useStudioMode } from "../lib/studio-host";
import { devServerLink, readScheme, storeScheme } from "../lib/scheme";
import type { StudioSource, StudioSurface } from "../lib/surfaces";

type LinkState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "unavailable"; reason: string };

const askForScheme = (initial: string): string | undefined => {
  const answer = window.prompt("Your app's URL scheme, so this can open it:", initial);
  const trimmed = answer?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  storeScheme(trimmed);
  return trimmed;
};

export const PreviewOnDevice = ({
  source,
  surface,
}: {
  source: StudioSource;
  surface: StudioSurface;
}) => {
  const hosted = useStudioMode() === "hosted";
  const [open, setOpen] = React.useState(false);
  const [scheme, setScheme] = React.useState(() => readScheme() ?? source.scheme);
  const [link, setLink] = React.useState<LinkState>({ status: "loading" });

  React.useEffect(() => {
    if (!open) return;

    // A hosted studio has no dev server to point at, so the host mints a link
    // that opens the live paywall through the SDK's debugger instead.
    if (hosted) {
      const build = source.previewLink;
      if (build === undefined) {
        setLink({ status: "unavailable", reason: "This studio cannot open paywalls on a device." });
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
      setLink({ status: "unavailable", reason: "Set your app's URL scheme to build a link." });
      return;
    }

    setLink({
      status: "ready",
      url: devServerLink(scheme, source.networkOrigin ?? window.location.origin, surface.id),
    });
  }, [open, hosted, scheme, source, surface]);

  return (
    <>
      <button className="sw-btn" type="button" onClick={() => setOpen(true)}>
        Preview
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Preview on a device"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-bar flex w-[22rem] max-w-full flex-col items-center gap-4 border border-cream/10 p-6 text-center"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <span className="text-[0.9375rem] font-medium">Preview on a device</span>
              <span className="text-[0.8125rem] text-cream/55">
                {hosted
                  ? "Scan with the device that has your app installed. It opens the live paywall in the SDK's debugger."
                  : "Scan with the device that has your app installed. It opens this paywall against this machine's dev server."}
              </span>
            </div>

            {link.status === "ready" ? (
              <>
                <div className="bg-cream p-3">
                  <QRCodeSVG value={link.url} size={192} />
                </div>
                <code className="max-w-full font-mono text-[0.6875rem] break-all text-cream/55">
                  {link.url}
                </code>
              </>
            ) : (
              <div className="flex size-[216px] flex-none items-center justify-center border border-cream/20 px-6 text-center text-[0.8125rem] text-cream/55">
                {link.status === "loading" ? "Building a link…" : link.reason}
              </div>
            )}

            <div className="flex items-center gap-2">
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
              <button className="sw-btn" type="button" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
