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

const OUTCOME: Record<string, { action: string; tone: EventNotice["tone"]; label: string }> = {
  completed: { action: "transaction_complete", tone: "success", label: "purchase completed." },
  abandoned: { action: "transaction_abandon", tone: "warning", label: "purchase abandoned." },
  granted: { action: "request_permission", tone: "success", label: "granted." },
  denied: { action: "request_permission", tone: "warning", label: "denied." },
  success: { action: "request_callback", tone: "success", label: "succeeded." },
  failure: { action: "request_callback", tone: "warning", label: "failed." },
};

const Outcome = ({ outcome, subject }: { outcome: string; subject: string }) => {
  const spec = OUTCOME[outcome] ?? OUTCOME.completed;
  return (
    <Toast action={spec?.action ?? "purchase"} tone={spec?.tone ?? "info"}>
      <Pill>{subject}</Pill> {spec?.label}
    </Toast>
  );
};

const ASK: Record<string, { action: string; verb: string; no: string; yes: string }> = {
  purchase: { action: "purchase", verb: "purchase", no: "Abandon", yes: "Complete" },
  permission: { action: "request_permission", verb: "permission", no: "Deny", yes: "Grant" },
  callback: { action: "request_callback", verb: "callback", no: "Fail", yes: "Succeed" },
};

const OUTCOMES: Record<string, readonly [string, string]> = {
  purchase: ["abandoned", "completed"],
  permission: ["denied", "granted"],
  callback: ["failure", "success"],
};

const Ask = ({
  kind,
  subject,
  onAnswer,
}: {
  kind: string;
  subject: string;
  onAnswer: (outcome: string) => void;
}) => {
  const spec = ASK[kind] ?? ASK.purchase;
  const [no, yes] = OUTCOMES[kind] ?? ["abandoned", "completed"];

  return (
    <Toast
      action={spec?.action ?? "purchase"}
      tone="info"
      actions={
        <>
          <button type="button" className="sw-btn" onClick={() => onAnswer(no)}>
            {spec?.no}
          </button>
          <button type="button" className="sw-btn sw-btn--primary" onClick={() => onAnswer(yes)}>
            {spec?.yes}
          </button>
        </>
      }
    >
      Tap triggered a <Pill>{spec?.verb}</Pill> for <Pill>{subject}</Pill>.
    </Toast>
  );
};

export const PaywallToasts = ({
  surfaceKey,
  raised = false,
}: {
  surfaceKey: string;
  raised?: boolean;
}) => {
  React.useEffect(() => {
    toast.dismiss();
  }, [surfaceKey]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isBridgeMessage(event.data)) return;

      if (event.data.type === "ask") {
        const { id, kind, subject } = event.data;
        const answer = (outcome: string) => {
          (event.source as Window | null)?.postMessage(
            { channel: STUDIO_CHANNEL, type: "answer", id, outcome },
            "*",
          );
          toast.dismiss(id);
          toast.custom(() => <Outcome outcome={outcome} subject={subject} />);
        };
        toast.custom(() => <Ask kind={kind} subject={subject} onAnswer={answer} />, {
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
      offset={raised ? 84 : 52}
      gap={8}
      visibleToasts={3}
      style={{ zIndex: 5 }}
      toastOptions={{ unstyled: true, classNames: { toast: "w-full" } }}
    />
  );
};
