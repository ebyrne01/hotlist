"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface BookPreviewProps {
  isbn: string | null;
  googleBooksId: string | null;
  title: string;
}

/**
 * Google Books Embedded Viewer — shows a "Read Preview" button that opens
 * an inline book preview powered by Google Books. Free, no API key required.
 *
 * Google is only touched after a reader clicks, so book pages do not make a
 * third-party preview lookup on every load.
 */
export default function BookPreview({
  isbn,
  googleBooksId,
  title,
}: BookPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const identifier = isbn || googleBooksId;

  // Load the Google Books viewer script
  const loadScript = useCallback(() => {
    if (scriptLoaded || typeof window === "undefined") return;

    // Check if already loaded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).google?.books) {
      setScriptLoaded(true);
      return;
    }

    // Define the callback before loading the script
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__googleBooksViewerCallback = () => {
      setScriptLoaded(true);
    };

    const script = document.createElement("script");
    script.src =
      "https://www.google.com/books/jsapi.js?callback=__googleBooksViewerCallback";
    script.async = true;
    document.head.appendChild(script);
  }, [scriptLoaded]);

  // Initialize viewer when script is loaded and modal is open
  useEffect(() => {
    if (!isOpen || !scriptLoaded || !viewerRef.current || !identifier) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google as {
      books: {
        load: () => void;
        setOnLoadCallback: (cb: () => void) => void;
        DefaultViewer: new (el: HTMLElement) => {
          load: (query: string) => void;
        };
      };
    };

    if (!google?.books) return;

    google.books.load();
    google.books.setOnLoadCallback(() => {
      if (!viewerRef.current) return;
      const viewer = new google.books.DefaultViewer(viewerRef.current);
      const query = isbn ? `ISBN:${isbn}` : identifier;
      viewer.load(query);
    });
  }, [isOpen, scriptLoaded, identifier, isbn]);

  // Don't render if we have no way to ask Google Books for this title.
  if (!identifier) return null;

  return (
    <>
      <button
        onClick={() => {
          loadScript();
          setIsOpen(true);
        }}
        className="inline-flex items-center gap-2 rounded-lg bg-white text-ink border border-border font-body text-sm px-4 min-h-[44px] hover:bg-cream transition-colors w-full justify-center"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-60"
        >
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        Read Preview
      </button>

      {/* Preview modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[80vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 className="font-display text-sm font-semibold text-ink truncate">
                {title}
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-muted hover:text-ink transition-colors p-1"
                aria-label="Close preview"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Viewer */}
            <div ref={viewerRef} className="flex-1 min-h-0" id="google-books-viewer" />

            {/* Footer */}
            <div className="px-4 py-2 border-t border-border text-xs font-mono text-muted/60 text-center shrink-0">
              Preview powered by Google Books
            </div>
          </div>
        </div>
      )}
    </>
  );
}
