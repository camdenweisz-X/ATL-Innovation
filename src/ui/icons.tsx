// Small stroke icon set (24px grid, 2px stroke). Paths are simple geometric shapes drawn for this app.
import type { SVGProps } from "react";

const paths: Record<string, string> = {
  home: "M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5",
  report: "M12 5v14M5 12h14",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  inbox: "M3.5 13.5 6 5h12l2.5 8.5M3.5 13.5V19h17v-5.5M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5",
  building: "M5 20V5.5L12 3l7 2.5V20M3 20h18M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 20v-3h4v3",
  settings: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7 7 0 0 1-1.8 1l-.3 2h-3.6l-.3-2a7 7 0 0 1-1.8-1l-1.9.7-1.8-3.1 1.6-1.2a7 7 0 0 1 0-3l-1.6-1.2 1.8-3.1 1.9.7a7 7 0 0 1 1.8-1l.3-2h3.6l.3 2a7 7 0 0 1 1.8 1l1.9-.7 1.8 3.1-1.6 1.2a7 7 0 0 1 0 3Z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  chevronRight: "m9 6 6 6-6 6",
  chevronLeft: "m15 6-6 6 6 6",
  chevronDown: "m6 9 6 6 6-6",
  check: "m5 12.5 4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  alert: "M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5M12 17.2v.1",
  clock: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 7.5V12l3 2",
  calendar: "M4 6h16v14H4zM4 10h16M8 3.5V7M16 3.5V7",
  calendarCheck: "M4 6h16v14H4zM4 10h16M8 3.5V7M16 3.5V7M9 15l2 2 4-4",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  unlock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2",
  paw: "M12 20c-2.5 0-5-1.4-5-3.6 0-1.9 2.3-4.4 5-4.4s5 2.5 5 4.4c0 2.2-2.5 3.6-5 3.6ZM6.5 10.5a1.8 2.2 0 1 0 0-.01ZM17.5 10.5a1.8 2.2 0 1 0 0-.01ZM9.5 6.5a1.7 2.1 0 1 0 0-.01ZM14.5 6.5a1.7 2.1 0 1 0 0-.01Z",
  message: "M4.5 5h15v11h-9l-4.5 3.5V16h-1.5z",
  send: "M4 12 20 4l-4 16-4-7-8-1ZM12 13l8-9",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  share: "M12 3.5V15M7.5 8 12 3.5 16.5 8M5 12v8h14v-8",
  mail: "M3.5 6h17v12h-17zM3.5 7l8.5 6 8.5-6",
  phone: "M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3A2 2 0 0 1 18.5 20 15 15 0 0 1 4.5 6a2 2 0 0 1 2-2.5Z",
  logout: "M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0",
  users: "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 19.5a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 13.5a6.5 6.5 0 0 1 3.5 6",
  key: "M14.5 9.5a5 5 0 1 0-4.8 6.3l1.3-1.3H13v-2h2v-2h1.5l1-1M7.5 15.5h.01",
  refresh: "M19.5 8A8 8 0 0 0 5 7M4.5 4v3.5H8M4.5 16a8 8 0 0 0 14.5 1M19.5 20v-3.5H16",
  trash: "M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5 7.5 20h9l1-13.5",
  pin: "M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15ZM10 20.5a2 2 0 0 0 4 0",
  shield: "M12 3.5 5 6v5.5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6Z",
  chart: "M5 20V11M11 20V5M17 20v-6M3 20h18",
  brand: "M4 11.2 12 4.5l8 6.7V20H4ZM8.6 14.6l2.4 2.4 4.6-4.8",
  wrench: "M14.5 6.5a4 4 0 0 0 5 5L12 19l-2.5.5L9 17l7.5-7.5a4 4 0 0 1-5-5l2 2 2-2Z",
  swap: "M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13",
  plus: "M12 5v14M5 12h14",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  image: "M4 5h16v14H4zM4 16l4.5-4.5 4 4 2.5-2.5 5 5M15.5 9.5h.01",
  info: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 11v5M12 8v.1",
  sparkle: "M12 3.5 13.8 9 19.5 10.5 13.8 12 12 17.5 10.2 12 4.5 10.5 10.2 9Z",
  video: "M3.5 7h12v10h-12zM15.5 10.5l5-3v9l-5-3",
  play: "M9 7.5v9l7.5-4.5Z",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14",
  printer: "M7 9V4h10v5M7 17H4.5V9h15v8H17M7 14h10v6H7z",
  translate: "M4 5.5h9M8.5 4v1.5c0 4-2 7-4.5 8.5M6 9.5c1.3 2 3.2 3.4 5.5 4M13 20l3.5-8.5L20 20M14.2 17.2h4.6",
  phoneOff: "M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3A2 2 0 0 1 18.5 20 15 15 0 0 1 4.5 6a2 2 0 0 1 2-2.5ZM4 4l16 16",
};

export type IconName = keyof typeof paths;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}
