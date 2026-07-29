import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AITokenSales CRM",
  description: "B2B LinkedIn Outreach CRM",
  // Tell Google Translate (and Chrome's built-in translate bar) to leave the
  // app alone. This is a stability fix, not a preference: Google Translate
  // swaps text nodes out of the live DOM behind React's back, so React's
  // reconciler later tries to remove or update nodes that are no longer where
  // it recorded them — the classic "NotFoundError: Failed to execute
  // 'removeChild' on 'Node'" crash that takes the whole page down mid-session.
  //
  // Suppressing it is only defensible because the app ships its own
  // translations (next-intl, 4 locales, switchable from the navbar), so a user
  // who needs another language has a first-class path that doesn't fight the
  // framework.
  other: { google: "notranslate" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `translate="no"` is the attribute browsers actually honour (the meta tag
    // above only covers Google's crawler-driven translation). Both are needed.
    // NOTE: `lang="zh"` is hardcoded here even though the app has 4 locales —
    // the real locale lives in the [locale] segment, so this is wrong for
    // en/es/vi and worth fixing separately (it affects screen readers and
    // hyphenation, not the UI copy).
    <html lang="zh" translate="no" className={`${inter.variable} h-full antialiased notranslate`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
