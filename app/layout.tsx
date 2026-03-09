import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import SignInModal from "@/components/auth/SignInModal";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hotlist — Find your next romance read",
  description: "Your next great read, already waiting. Compare romance and romantasy books side by side with ratings, spice levels, tropes, and AI synopses.",
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
