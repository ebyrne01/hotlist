import type { Metadata, Viewport } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import SignInModal from "@/components/auth/SignInModal";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hotlist — Find your next romance read",
  description:
    "Your next great read, already waiting. Compare romance and romantasy books side by side with ratings, spice levels, tropes, and AI synopses.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://myhotlist.app"),
  openGraph: {
    title: "Hotlist — Find your next romance read",
    description: "Every rating. Every trope. One decision.",
    siteName: "Hotlist",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Hotlist",
    description: "Every rating. Every trope. One decision.",
  },
  appleWebApp: {
    capable: true,
    title: "Hotlist",
    statusBarStyle: "black-translucent",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#d4430e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased flex flex-col min-h-screen">
        <AuthProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
          <SignInModal />
        </AuthProvider>
      </body>
    </html>
  );
}
