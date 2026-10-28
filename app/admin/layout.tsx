import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  icons: {
    icon: [{ url: "/admin-favicon.ico", type: "image/x-icon" }],
    shortcut: "/admin-favicon.ico",
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
