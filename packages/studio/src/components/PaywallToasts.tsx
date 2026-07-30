import * as React from "react";
import { toast, Toaster } from "sonner";
import {
  AlertTriangleIcon,
  BellIcon,
  BoltIcon,
  CartIcon,
  CheckCircleIcon,
  CloseIcon,
  ExternalIcon,
  InfoCircleIcon,
  RotateIcon,
  StarIcon,
  UserIcon,
} from "./icons";
import { isBridgeMessage, noticeFor, STUDIO_CHANNEL, type EventNotice } from "../lib/events";

const TINT: Record<EventNotice["tone"], string> = {
  info: "text-cream/45",
  success: "text-accent",
  warning: "text-red",
};

const ICON: Record<string, () => React.ReactElement> = {
  purchase: CartIcon,
  transaction_complete: CheckCircleIcon,
  freeTrial_start: CheckCircleIcon,
  transaction_abandon: AlertTriangleIcon,
  transaction_fail: AlertTriangleIcon,
  close: CloseIcon,
  restore: RotateIcon,
  open_url: ExternalIcon,
  open_url_external: ExternalIcon,
  open_deep_link: ExternalIcon,
  initiate_web_checkout: CartIcon,
  open_payment_sheet: CartIcon,
  custom_placement: BoltIcon,
  custom: BoltIcon,
  request_permission: BoltIcon,
  request_callback: BoltIcon,
  schedule_notification: BellIcon,
  request_store_review: StarIcon,
  user_attribute_updated: UserIcon,
};

const Pill = ({ children }: React.PropsWithChildren) => (
  <span className="bg-accent/15 text-accent px-1.5 py-px font-mono text-xs whitespace-nowrap">
    {children}
  </span>
);

/**
 * The icon sits in a box the height of one line of title text, so it centres on
 * the first line whatever the message wraps to.
 */
const Toast = ({
  action,
  tone,
  children,
  actions,
}: React.PropsWithChildren<{
  action: string;
  tone: EventNotice["tone"];
  actions?: React.ReactNode;
}>) => {
  const Icon = ICON[action] ?? InfoCircleIcon;
  return (
    <div className="bg-panel font-sans w-[344px] border border-cream/15 p-3 shadow-[0_8px_24px_-8px] shadow-black/60">
      <div className="grid grid-cols-[14px_1fr] items-start gap-x-2.5">
        <span className={`flex h-5 items-center justify-center ${TINT[tone]}`}>
          <Icon />
        </span>
        <span className="text-[0.8125rem] leading-5 font-medium text-cream">{children}</span>
        {actions && <div className="col-start-2 mt-2.5 flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
};

const Notice = ({ notice }: { notice: EventNotice }) => (
  <Toast action={notice.action} tone={notice.tone}>
    Tap triggered a <Pill>{notice.action}</Pill>
    {notice.subject ? (
      <>
        {" for "}
        <Pill>{notice.subject}</Pill>
      </>
    ) : (
      " action"
    )}
    .
  </Toast>
);

const Outcome = ({ action, reference }: { action: string; reference: string }) => (
  <Toast
    action={action === "completed" ? "transaction_complete" : "transaction_abandon"}
    tone={action === "completed" ? "success" : "warning"}
  >
    <Pill>{reference}</Pill>
    {action === "completed" ? " purchase completed." : " purchase abandoned."}
  </Toast>
);

const PurchaseAsk = ({
  reference,
  onAnswer,
}: {
  reference: string;
  onAnswer: (outcome: "completed" | "abandoned") => void;
}) => (
  <Toast
    action="purchase"
    tone="info"
    actions={
      <>
        <button type="button" className="sw-btn" onClick={() => onAnswer("abandoned")}>
          Abandon
        </button>
        <button
          type="button"
          className="sw-btn sw-btn--primary"
          onClick={() => onAnswer("completed")}
        >
          Complete
        </button>
      </>
    }
  >
    Tap triggered a <Pill>purchase</Pill> for <Pill>{reference}</Pill>.
  </Toast>
);

export const PaywallToasts = ({ surfaceKey }: { surfaceKey: string }) => {
  React.useEffect(() => {
    toast.dismiss();
  }, [surfaceKey]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isBridgeMessage(event.data)) return;

      if (event.data.type === "ask") {
        const { id, reference } = event.data;
        const answer = (outcome: "completed" | "abandoned") => {
          (event.source as Window | null)?.postMessage(
            { channel: STUDIO_CHANNEL, type: "answer", id, outcome },
            "*",
          );
          toast.dismiss(id);
          toast.custom(() => <Outcome action={outcome} reference={reference} />);
        };
        toast.custom(() => <PurchaseAsk reference={reference} onAnswer={answer} />, {
          id,
          duration: Number.POSITIVE_INFINITY,
        });
        return;
      }

      const notice = noticeFor(event.data.message);
      if (notice) toast.custom(() => <Notice notice={notice} />);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <Toaster
      position="top-center"
      swipeDirections={["top"]}
      offset={52}
      gap={8}
      visibleToasts={3}
      style={{ zIndex: 5 }}
      toastOptions={{ unstyled: true, classNames: { toast: "w-full" } }}
    />
  );
};
