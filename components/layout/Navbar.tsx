"use client";

import { useState } from "react";
import Link from "next/link";
import SearchBar from "@/components/search/SearchBar";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSignInModal } from "@/lib/auth/useSignInModal";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, profile, isLoading, signOut } = useAuth();
  const { openSignIn } = useSignInModal();

  const displayName =
    profile?.displayName ??
    user?.user_metadata?.full_name ??
    user?.email?.split("@")[0] ??
    "Account";

  const avatarUrl =
    profile?.avatarUrl ?? user?.user_metadata?.avatar_url ?? null;

  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <nav className="sticky top-0 z-50 bg-cream/95 backdrop-blur border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
        {/* Wordmark */}
        <Link
          href="/"
          className="font-display text-xl font-bold text-ink italic shrink-0"
        >
          Hotlist
        </Link>

        {/* Desktop search */}
        <div className="hidden sm:block flex-1 max-w-md">
          <SearchBar variant="navbar" />
        </div>

        {/* Spacer */}
        <div className="flex-1 sm:hidden" />

        {/* Desktop nav links */}
        <div className="hidden sm:flex items-center gap-4 ml-auto">
          <Link
            href="/booktok"
            className="text-xs font-mono text-fire/80 font-medium hover:text-fire transition-colors"
          >
            BookTok
          </Link>
          <Link
            href="/discover"
            className="text-xs font-mono text-muted hover:text-ink transition-colors"
          >
            Discover
          </Link>
          {user && (
            <>
              <Link
                href="/lists"
                className="text-xs font-mono text-fire hover:text-fire/80 transition-colors font-medium"
              >
                My Hotlists
              </Link>
              <Link
                href="/reading"
                className="text-xs font-mono text-muted hover:text-ink transition-colors"
              >
                Reading List
              </Link>
            </>
          )}
          {isLoading ? (
            <div className="w-8 h-8 rounded-full bg-border animate-pulse" />
          ) : user ? (
            <div className="relative group">
              <button className="flex items-center gap-2">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="w-8 h-8 rounded-full object-cover border border-border"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-fire text-cream flex items-center justify-center text-xs font-mono font-bold">
                    {initials}
                  </div>
                )}
              </button>
              <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all min-w-[160px]">
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-xs font-mono text-ink font-semibold truncate">
                    {displayName}
                  </p>
                  <p className="text-xs font-mono text-muted truncate">
                    {user.email}
                  </p>
                </div>
                <Link
                  href="/profile"
                  className="block px-3 py-2 text-xs font-mono text-muted hover:text-ink hover:bg-cream transition-colors"
                >
                  Profile
                </Link>
                <Link
                  href="/lists"
                  className="block px-3 py-2 text-xs font-mono text-muted hover:text-ink hover:bg-cream transition-colors"
                >
                  My Hotlists
                </Link>
                <button
                  onClick={signOut}
                  className="block w-full text-left px-3 py-2 text-xs font-mono text-muted hover:text-ink hover:bg-cream transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => openSignIn()}
              className="text-xs font-mono text-muted hover:text-ink transition-colors"
            >
              Sign In
            </button>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="sm:hidden w-10 h-10 flex items-center justify-center text-ink"
          aria-label="Menu"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            {menuOpen ? (
              <>
                <line x1="4" y1="4" x2="16" y2="16" />
                <line x1="16" y1="4" x2="4" y2="16" />
              </>
            ) : (
              <>
                <line x1="3" y1="5" x2="17" y2="5" />
                <line x1="3" y1="10" x2="17" y2="10" />
                <line x1="3" y1="15" x2="17" y2="15" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="sm:hidden border-t border-border bg-cream px-4 py-3 space-y-3">
          <SearchBar variant="navbar" />
          <div className="flex flex-col gap-2">
            <Link
              href="/booktok"
              className="text-sm font-mono text-fire/80 font-medium hover:text-fire transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              BookTok
            </Link>
            <Link
              href="/discover"
              className="text-sm font-mono text-muted hover:text-ink transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              Discover Creators
            </Link>
            {user ? (
              <>
                <Link
                  href="/lists"
                  className="text-sm font-mono text-fire font-medium hover:text-fire/80 transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  My Hotlists
                </Link>
                <Link
                  href="/reading"
                  className="text-sm font-mono text-muted hover:text-ink transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  Reading List
                </Link>
                <Link
                  href="/profile"
                  className="text-sm font-mono text-muted hover:text-ink transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  Profile
                </Link>
                <button
                  onClick={() => {
                    signOut();
                    setMenuOpen(false);
                  }}
                  className="text-left text-sm font-mono text-muted hover:text-ink transition-colors"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  openSignIn();
                  setMenuOpen(false);
                }}
                className="text-left text-sm font-mono text-muted hover:text-ink transition-colors"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
