import * as React from "react";
import { toast } from "sonner";
import { ToastCard } from "../components/PaywallToasts";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoCircleIcon,
  type IconComponent,
} from "../components/icons";

type Tone = "info" | "success" | "warning";

const ICON: Record<Tone, IconComponent> = {
  info: InfoCircleIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
};

export const notify = (
  title: React.ReactNode,
  { tone = "info", description }: { tone?: Tone; description?: React.ReactNode } = {},
) => {
  toast.custom(() => (
    <ToastCard icon={ICON[tone]} tone={tone} description={description}>
      {title}
    </ToastCard>
  ));
};
