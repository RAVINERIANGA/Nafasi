import type { Metadata, Viewport } from "next";
import { Provider } from "@/services/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "NAFASI — simulated bed reservation",
  description: "Simulated emergency bed reservation prototype. Fictional patients only. Not for clinical use.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#083f3c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-ink antialiased">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
