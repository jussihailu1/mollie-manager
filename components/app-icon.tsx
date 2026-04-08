import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

export type AppIconName =
  | "alert"
  | "check"
  | "chevron-right"
  | "close"
  | "customer"
  | "home"
  | "link"
  | "payment"
  | "plus"
  | "refresh"
  | "settings"
  | "subscription";

const iconPaths: Record<AppIconName, React.ReactNode> = {
  alert: (
    <path
      d="M12 3.75 2.25 20.25h19.5L12 3.75Zm0 5.25v4.5m0 3h.008"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  ),
  check: (
    <path
      d="m5.25 12.75 4.5 4.5 9-10.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  ),
  "chevron-right": (
    <path
      d="m9 6 6 6-6 6"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  ),
  close: (
    <path
      d="m6 6 12 12M18 6 6 18"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  ),
  customer: (
    <>
      <path
        d="M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 19.5a7.5 7.5 0 0 1 15 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </>
  ),
  home: (
    <path
      d="M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-3.75v-6h-7.5v6H4.5A1.5 1.5 0 0 1 3 19.5v-9Z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  ),
  link: (
    <>
      <path
        d="M13.5 7.5 16.5 4.5a3.182 3.182 0 1 1 4.5 4.5l-3 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="m10.5 16.5-3 3a3.182 3.182 0 0 1-4.5-4.5l3-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="m8.25 15.75 7.5-7.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </>
  ),
  payment: (
    <>
      <rect
        x="3.75"
        y="5.25"
        width="16.5"
        height="13.5"
        rx="2.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M3.75 9h16.5M7.5 14.25h3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </>
  ),
  plus: (
    <path
      d="M12 5.25v13.5M5.25 12h13.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.8"
    />
  ),
  refresh: (
    <path
      d="M16.024 8.25H20.25V4.024M7.976 15.75H3.75v4.226M19.287 12a7.287 7.287 0 0 0-12.442-5.151L3.75 10.5m16.5 3-3.095 3.651A7.287 7.287 0 0 1 4.713 12"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  ),
  settings: (
    <path
      d="m9.596 3.938-.352 1.525a7.532 7.532 0 0 0-1.47.612L6.42 5.22a1.125 1.125 0 0 0-1.591 0L3.72 6.329a1.125 1.125 0 0 0 0 1.591l.855 1.354c-.258.468-.463.963-.612 1.47l-1.525.352A1.125 1.125 0 0 0 1.5 12v1.5c0 .52.358.973.868 1.091l1.525.352c.149.507.354 1.002.612 1.47l-.855 1.354a1.125 1.125 0 0 0 0 1.591l1.109 1.109c.44.44 1.152.44 1.591 0l1.354-.855c.468.258.963.463 1.47.612l.352 1.525c.118.51.571.868 1.091.868h1.5c.52 0 .973-.358 1.091-.868l.352-1.525a7.532 7.532 0 0 0 1.47-.612l1.354.855c.439.44 1.151.44 1.591 0l1.109-1.109a1.125 1.125 0 0 0 0-1.591l-.855-1.354c.258-.468.463-.963.612-1.47l1.525-.352c.51-.118.868-.571.868-1.091V12c0-.52-.358-.973-.868-1.091l-1.525-.352a7.532 7.532 0 0 0-.612-1.47l.855-1.354a1.125 1.125 0 0 0 0-1.591L19.171 5.22a1.125 1.125 0 0 0-1.591 0l-1.354.855a7.532 7.532 0 0 0-1.47-.612l-.352-1.525A1.125 1.125 0 0 0 13.313 3h-1.5c-.52 0-.973.358-1.091.868Z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.2"
    />
  ),
  subscription: (
    <>
      <path
        d="M6 4.5h9a4.5 4.5 0 0 1 0 9H9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <path
        d="m9 10.5-3 3 3 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
};

export function AppIcon({
  name,
  className,
  ...props
}: Readonly<SVGProps<SVGSVGElement> & { name: AppIconName; className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("h-4 w-4 shrink-0", className)}
      fill="none"
      {...props}
    >
      {iconPaths[name]}
    </svg>
  );
}
