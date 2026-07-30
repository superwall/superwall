import * as React from "react";

const Icon = ({ children }: React.PropsWithChildren) => (
  <svg className="sw-icon" viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);

export const ChevronLeftIcon = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);

export const RotateIcon = () => (
  <Icon>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Icon>
);

export const ExternalIcon = () => (
  <Icon>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
);

export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = () => (
  <Icon>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </Icon>
);

export const ResetIcon = () => (
  <Icon>
    <path d="M3 12a9 9 0 1 0 2.64-6.36" />
    <path d="M3 3v6h6" />
  </Icon>
);

export const SlidersIcon = () => (
  <Icon>
    <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3" />
    <path d="M14 2v4M8 10v4M16 18v4" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const ColumnsIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" />
    <path d="M12 4v16" />
  </Icon>
);

export const CheckCircleIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Icon>
);

export const AlertTriangleIcon = () => (
  <Icon>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
);

export const InfoCircleIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Icon>
);

export const BoltIcon = () => (
  <Icon>
    <path d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z" />
  </Icon>
);

export const CartIcon = () => (
  <Icon>
    <circle cx="9" cy="20" r="1" />
    <circle cx="18" cy="20" r="1" />
    <path d="M2 3h2.5l2.2 11.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H5.4" />
  </Icon>
);

export const BellIcon = () => (
  <Icon>
    <path d="M18 8a6 6 0 1 0-12 0c0 6-2 8-2 8h16s-2-2-2-8" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </Icon>
);

export const StarIcon = () => (
  <Icon>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />
  </Icon>
);

export const UserIcon = () => (
  <Icon>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Icon>
);

export const RotateDeviceIcon = () => (
  <Icon>
    <rect x="4" y="2" width="10" height="16" rx="2" />
    <path d="M17 12a5 5 0 0 1-5 9H9" />
    <path d="m11 19-2 2 2 2" />
  </Icon>
);
