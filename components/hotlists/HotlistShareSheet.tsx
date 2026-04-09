"use client";

import { useState, useEffect, useCallback } from "react";

interface Props {
  shareSlug: string;
  hotlistName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function HotlistShareSheet({
  shareSlug,
  hotlistName,
  isOpen,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/lists/${shareSlug}`
      : `/lists/${shareSlug}`;

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  async function handleCopyLink() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDownloadImage() {
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/hotlists/${shareSlug}/og-image?size=stories`
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${hotlistName.replace(/[^a-zA-Z0-9]/g, "-")}-hotlist.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[handleDownloadImage] failed:", err);
    } finally {
      setDownloading(false);
    }
  }

  async function handleNativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: hotlistName,
          text: `Check out my Hotlist: ${hotlistName}`,
          url: shareUrl,
        });
      } catch {
        // User cancelled share — not an error
      }
    } else {
      await handleCopyLink();
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 bg-cream rounded-t-2xl shadow-2xl p-6 pb-8 max-w-lg mx-auto animate-in slide-in-from-bottom duration-200 sm:relative sm:inset-auto sm:rounded-xl sm:mt-2">
        <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5 sm:hidden" />

        <h3 className="font-display text-lg font-bold text-ink mb-1">
          Share this Hotlist
        </h3>
        <p className="text-xs font-mono text-muted mb-5 truncate">
          {hotlistName}
        </p>

        <div className="flex flex-col gap-3">
          {/* Copy Link */}
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-border hover:border-fire/30 hover:bg-fire/5 transition-colors text-left"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-fire shrink-0"
            >
              <path d="M7.5 10.5a3.75 3.75 0 005.303 0l2.25-2.25a3.75 3.75 0 00-5.303-5.303L8.625 4.072" />
              <path d="M10.5 7.5a3.75 3.75 0 00-5.303 0l-2.25 2.25a3.75 3.75 0 005.303 5.303L9.375 13.928" />
            </svg>
            <div>
              <span className="text-sm font-mono text-ink block">
                {copied ? "Copied!" : "Copy Link"}
              </span>
              <span className="text-xs font-mono text-muted">
                Share the URL directly
              </span>
            </div>
          </button>

          {/* Download Image */}
          <button
            onClick={handleDownloadImage}
            disabled={downloading}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-border hover:border-fire/30 hover:bg-fire/5 transition-colors text-left disabled:opacity-50"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-fire shrink-0"
            >
              <path d="M3 12.75v1.5a1.5 1.5 0 001.5 1.5h9a1.5 1.5 0 001.5-1.5v-1.5" />
              <path d="M9 3v9m0 0l-3-3m3 3l3-3" />
            </svg>
            <div>
              <span className="text-sm font-mono text-ink block">
                {downloading ? "Downloading..." : "Download Image"}
              </span>
              <span className="text-xs font-mono text-muted">
                Stories-sized card (1080×1920)
              </span>
            </div>
          </button>

          {/* Share (native or fallback) */}
          <button
            onClick={handleNativeShare}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-border hover:border-fire/30 hover:bg-fire/5 transition-colors text-left"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-fire shrink-0"
            >
              <circle cx="13.5" cy="3.75" r="2.25" />
              <circle cx="4.5" cy="9" r="2.25" />
              <circle cx="13.5" cy="14.25" r="2.25" />
              <path d="M6.44 10.16l5.13 2.93M11.56 4.91L6.44 7.84" />
            </svg>
            <div>
              <span className="text-sm font-mono text-ink block">Share</span>
              <span className="text-xs font-mono text-muted">
                Send via your favorite app
              </span>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}
