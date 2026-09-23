interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.85,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false as const,
});

export function ShieldCheckIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3l7 2.6v5.6c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V5.6L12 3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </svg>
  );
}

export function CheckIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="m8.25 12.25 2.5 2.5 5-5.25" />
    </svg>
  );
}

export function InfoIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 11v5.25" />
      <path d="M12 7.75h.01" />
    </svg>
  );
}

export function AlertTriangleIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4.5 21 19.5H3L12 4.5Z" />
      <path d="M12 10v4" />
      <path d="M12 16.75h.01" />
    </svg>
  );
}

export function AlertOctagonIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8.3 3.5h7.4L20.5 8.3v7.4L15.7 20.5H8.3L3.5 15.7V8.3L8.3 3.5Z" />
      <path d="M12 8v4.5" />
      <path d="M12 15.75h.01" />
    </svg>
  );
}

export function FileTextIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5L14 3.5Z" />
      <path d="M13.75 3.75V8h4.1" />
      <path d="M9 13h6" />
      <path d="M9 16.5h4" />
    </svg>
  );
}

export function UploadIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 15.5V5.75" />
      <path d="m8.25 9.25 3.75-3.5 3.75 3.5" />
      <path d="M4.75 15v2.75A1.75 1.75 0 0 0 6.5 19.5h11a1.75 1.75 0 0 0 1.75-1.75V15" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.75 12h14" />
      <path d="m13.25 6.5 5.5 5.5-5.5 5.5" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M19.25 12h-14" />
      <path d="m10.75 6.5-5.5 5.5 5.5 5.5" />
    </svg>
  );
}

export function BankIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.75 9.5 12 4.75l8.25 4.75" />
      <path d="M5.5 9.75v8" />
      <path d="M10 9.75v8" />
      <path d="M14 9.75v8" />
      <path d="M18.5 9.75v8" />
      <path d="M3.5 19.25h17" />
    </svg>
  );
}

export function GraduationCapIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4.75 21.25 9 12 13.25 2.75 9 12 4.75Z" />
      <path d="M6.75 11v4.4c0 .9 2.35 2.35 5.25 2.35s5.25-1.45 5.25-2.35V11" />
      <path d="M21.25 9v5" />
    </svg>
  );
}

export function UmbrellaIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.25 12.5a8.75 8.75 0 0 1 17.5 0Z" />
      <path d="M12 12.5v5.25a1.75 1.75 0 0 0 3.5 0" />
      <path d="M12 4.75V3.5" />
    </svg>
  );
}

export function WalletIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.75 8.25A1.5 1.5 0 0 1 6.25 6.75h11a1.5 1.5 0 0 1 1.5 1.5" />
      <path d="M4.75 8.25v9A1.5 1.5 0 0 0 6.25 18.75h12.5a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H6.25" />
      <path d="M16.25 13.5h.01" />
    </svg>
  );
}

export function ChartIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.75 19.25h14.5" />
      <path d="M7.25 19V11" />
      <path d="M12 19V5.75" />
      <path d="M16.75 19v-5" />
    </svg>
  );
}

export function XIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m6.75 6.75 10.5 10.5" />
      <path d="m17.25 6.75-10.5 10.5" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m6.5 9.75 5.5 5.5 5.5-5.5" />
    </svg>
  );
}

export function MailIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3.25" y="5.75" width="17.5" height="12.5" rx="1.75" />
      <path d="m4.5 7.5 7.5 5.25L19.5 7.5" />
    </svg>
  );
}

export function LogOutIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M14.75 8V6.5a1.25 1.25 0 0 0-1.25-1.25h-7A1.25 1.25 0 0 0 5.25 6.5v11a1.25 1.25 0 0 0 1.25 1.25h7a1.25 1.25 0 0 0 1.25-1.25V16" />
      <path d="M9.75 12h9" />
      <path d="m16 9.25 2.75 2.75L16 14.75" />
    </svg>
  );
}

export function PlusIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 5.25v13.5" />
      <path d="M5.25 12h13.5" />
    </svg>
  );
}

export function PencilIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.75 19.25l.75-3.75L15.5 5.5a1.77 1.77 0 0 1 2.5 0l.5.5a1.77 1.77 0 0 1 0 2.5L8.5 18.5l-3.75.75Z" />
      <path d="m14.25 6.75 3 3" />
    </svg>
  );
}

export function ExternalLinkIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13.5 5.25h5.25V10.5" />
      <path d="M18.25 5.75 11 13" />
      <path d="M17.5 14v4.25a1.25 1.25 0 0 1-1.25 1.25H5.75A1.25 1.25 0 0 1 4.5 18.25V7.75A1.25 1.25 0 0 1 5.75 6.5H10" />
    </svg>
  );
}
