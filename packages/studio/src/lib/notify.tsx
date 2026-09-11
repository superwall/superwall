import * as React from "react";
import { toast } from "sonner";
import { AlertTriangleIcon, CheckCircleIcon, InfoCircleIcon } from "../components/icons";

type Tone = "info" | "success" | "warning";

const TINT: Record<Tone, string> = {
  info: "text-cream/45",
  success: "text-accent",
  warning: "text-red",
};

const ICON: Record<Tone, () => React.ReactElement> = {
  info: InfoCircleIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
};

export const notify = (message: React.ReactNode, tone: Tone = "info") => {
  const Icon = ICON[tone];
  toast.custom(() => (
    <div className="bg-panel font-sans w-[344px] border border-cream/15 p-3 shadow-[0_8px_24px_-8px] shadow-black/60">
      <div className="grid grid-cols-[14px_1fr] items-start gap-x-2.5">
        <span className={`flex h-5 items-center justify-center ${TINT[tone]}`}>
          <Icon />
        </span>
        <span className="text-[0.8125rem] leading-5 font-medium text-cream">{message}</span>
      </div>
    </div>
  ));
};
