"use client";

import { useEffect, useCallback, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSignInModal } from "@/lib/auth/useSignInModal";

export default function SignInModal() {
  const { isOpen, onSuccess, closeSignIn } = useSignInModal();
  const { signInWithGoogle, signInWithApple, user } = useAuth();
  const [loading, setLoading] = useState(false);

  // Close on ESC
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSignIn();
    },
    [closeSignIn]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  // Fire onSuccess callback when user signs in
  useEffect(() => {
    if (user && isOpen && onSuccess) {
      closeSignIn();
      onSuccess();
    } else if (user && isOpen) {
      closeSignIn();
    }
  }, [user, isOpen, onSuccess, closeSignIn]);

  if (!isOpen) return null;

  async function handleGoogle() {
    setLoading(true);
    await signInWithGoogle();
  }

  async function handleApple() {
    setLoading(true);
    await signInWithApple();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSignIn();
      }}
    >
      <div className="bg-cream rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8 relative animate-in fade-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          onClick={closeSignIn}
          className="absolute top-4 right-4 text-muted hover:text-ink transition-colors"
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="4" x2="16" y2="16" />
            <line x1="16" y1="4" x2="4" y2="16" />
          </svg>
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="font-display text-2xl font-bold text-ink italic">
            Hotlist 🔥
          </h2>
          <p className="font-display text-lg font-semibold text-ink mt-3">
            Save books. Build your Hotlist.
          </p>
          <p className="text-sm text-muted mt-1">
            Sign in free — no password needed.
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted">Redirecting to sign in...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Google */}
            <button
              onClick={handleGoogle}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-border rounded-lg hover:bg-gray-50 transition-colors font-mono text-sm text-ink"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
                <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.166 6.656 3.58 9 3.58Z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            {/* Apple */}
            <button
              onClick={handleApple}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-ink text-cream rounded-lg hover:bg-ink/90 transition-colors font-mono text-sm"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M14.94 9.88c-.02-2.08 1.7-3.08 1.78-3.13-0.97-1.42-2.48-1.61-3.01-1.63-1.28-.13-2.5.75-3.15.75-.65 0-1.65-.73-2.71-.71-1.4.02-2.68.81-3.4 2.06-1.45 2.52-.37 6.25 1.04 8.3.69 1 1.51 2.12 2.59 2.08 1.04-.04 1.43-.67 2.69-.67 1.25 0 1.61.67 2.71.65 1.12-.02 1.82-.102 2.51-2.05.79-1.86.31-3.67-.05-4.65Zm-3.56-8.56C12.04.48 12.5-.58 12.37-1.63c-.97.04-2.14.65-2.84 1.46-.62.72-1.17 1.87-1.02 2.97 1.08.08 2.18-.55 2.87-1.48Z" transform="translate(0,3)"/>
              </svg>
              Continue with Apple
            </button>
          </div>
        )}

        <p className="text-xs text-muted/60 text-center mt-6 leading-relaxed">
          By signing in you agree to our Terms & Privacy Policy
        </p>
      </div>
    </div>
  );
}
