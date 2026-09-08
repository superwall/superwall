import * as React from "react";
import { toast, Toaster } from "sonner";
import type { HostDelegate } from "@superwall/host";
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
import { noticeFor, type EventNotice } from "../lib/events";

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
  restore_complete: CheckCircleIcon,
  restore_fail: AlertTriangleIcon,
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

type Choice<T> = {
  label: string;
  value: T;
  primary?: boolean;
  action: string;
  tone: EventNotice["tone"];
  done: string;
};

const Outcome = <T,>({ choice, subject }: { choice: Choice<T>; subject: string }) => (
  <Toast action={choice.action} tone={choice.tone}>
    <Pill>{subject}</Pill> {choice.done}
  </Toast>
);

const Ask = <T,>({
  action,
  verb,
  subject,
  choices,
  onAnswer,
}: {
  action: string;
  verb: string;
  subject: string;
  choices: readonly Choice<T>[];
  onAnswer: (choice: Choice<T>) => void;
}) => (
  <Toast
    action={action}
    tone="info"
    actions={choices.map((choice) => (
      <button
        key={choice.label}
        type="button"
        className={choice.primary ? "sw-btn sw-btn--primary" : "sw-btn"}
        onClick={() => onAnswer(choice)}
      >
        {choice.label}
      </button>
    ))}
  >
    Tap triggered a <Pill>{verb}</Pill> for <Pill>{subject}</Pill>.
  </Toast>
);

const PURCHASE: readonly Choice<"completed" | "abandoned" | "failed">[] = [
  {
    label: "Abandon",
    value: "abandoned",
    action: "transaction_abandon",
    tone: "warning",
    done: "purchase abandoned.",
  },
  {
    label: "Fail",
    value: "failed",
    action: "transaction_fail",
    tone: "warning",
    done: "purchase failed.",
  },
  {
    label: "Complete",
    value: "completed",
    primary: true,
    action: "transaction_complete",
    tone: "success",
    done: "purchase completed.",
  },
];

const RESTORE: readonly Choice<"restored" | "failed">[] = [
  {
    label: "Nothing",
    value: "failed",
    action: "restore_fail",
    tone: "warning",
    done: "nothing to restore.",
  },
  {
    label: "Restore",
    value: "restored",
    primary: true,
    action: "restore_complete",
    tone: "success",
    done: "restored.",
  },
];

const PERMISSION: readonly Choice<"granted" | "denied">[] = [
  {
    label: "Deny",
    value: "denied",
    action: "request_permission",
    tone: "warning",
    done: "denied.",
  },
  {
    label: "Grant",
    value: "granted",
    primary: true,
    action: "request_permission",
    tone: "success",
    done: "granted.",
  },
];

const CALLBACK: readonly Choice<"success" | "failure">[] = [
  { label: "Fail", value: "failure", action: "request_callback", tone: "warning", done: "failed." },
  {
    label: "Succeed",
    value: "success",
    primary: true,
    action: "request_callback",
    tone: "success",
    done: "succeeded.",
  },
];

let asked = 0;

const ask = <T,>(
  action: string,
  verb: string,
  subject: string,
  choices: readonly Choice<T>[],
): Promise<T> =>
  new Promise((resolve) => {
    const id = `${action}-${(asked += 1)}`;
    toast.custom(
      () => (
        <Ask
          action={action}
          verb={verb}
          subject={subject}
          choices={choices}
          onAnswer={(choice) => {
            toast.dismiss(id);
            toast.custom(() => <Outcome choice={choice} subject={subject} />);
            resolve(choice.value);
          }}
        />
      ),
      { id, duration: Number.POSITIVE_INFINITY },
    );
  });

export const createStudioDelegate = (): HostDelegate => ({
  event: (message) => {
    const notice = noticeFor(message);
    if (notice) toast.custom(() => <Notice notice={notice} />);
  },
  purchase: (product) => ask("purchase", "purchase", product.reference, PURCHASE),
  restore: () => ask("restore", "restore", "purchases", RESTORE),
  close: () => {},
  openUrl: () => {},
  custom: () => {},
  customPlacement: () => {},
  permission: (type) => ask("request_permission", "permission", type, PERMISSION),
  callback: (name) =>
    ask("request_callback", "callback", name, CALLBACK).then((status) => ({ status })),
});

export const useStudioDelegate = (): HostDelegate => React.useMemo(createStudioDelegate, []);

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
