import type { Metadata, Viewport } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import SignInModal from "@/components/auth/SignInModal";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hotlist — Is it hot? Ratings, spice & tropes for every romance book",
  description:
    "Bring any romance or romantasy book. Hotlist shows you ratings from Goodreads, Amazon, and Romance.io, community spice levels, tropes, and BookTok buzz — so you can decide what to read next.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://myhotlist.app"),
  openGraph: {
    title: "Hotlist — Is it hot? Ratings, spice & tropes for every romance book",
    description: "Bring any book. We'll tell you if it's hot.",
    siteName: "Hotlist",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Hotlist",
    description: "Bring any book. We'll tell you if it's hot.",
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
