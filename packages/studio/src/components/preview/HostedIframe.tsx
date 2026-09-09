import * as React from "react";
import {
  createWindowHost,
  type HostDelegate,
  type HostState,
  type PaywallHost,
} from "@superwall/host";
import { hostPatch } from "../../lib/host";

type Hosted = { host: PaywallHost; detach: () => void; sent: HostState };

const useHostedWindow = (hostState: HostState, delegate: HostDelegate) => {
  const hosted = React.useRef<Hosted | undefined>(undefined);
  const initial = React.useRef({ hostState, delegate });

  const ref = React.useCallback((node: HTMLIFrameElement | null) => {
    hosted.current?.detach();
    hosted.current = undefined;
    if (!node?.contentWindow) return;
    const { host, detach } = createWindowHost({
      target: node.contentWindow,
      state: initial.current.hostState,
      delegate: initial.current.delegate,
    });
    hosted.current = { host, detach, sent: initial.current.hostState };
  }, []);

  React.useEffect(() => {
    initial.current = { hostState, delegate };
    const current = hosted.current;
    if (!current) return;
    current.host.update(hostPatch(current.sent, hostState));
    current.sent = hostState;
  }, [hostState, delegate]);

  return ref;
};

export type HostedIframeProps = React.ComponentPropsWithoutRef<"iframe"> & {
  hostState: HostState;
  delegate: HostDelegate;
};

export const HostedIframe = ({ hostState, delegate, ...iframe }: HostedIframeProps) => (
  <iframe {...iframe} ref={useHostedWindow(hostState, delegate)} />
);
