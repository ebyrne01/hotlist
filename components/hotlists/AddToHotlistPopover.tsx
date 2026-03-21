"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSignInModal } from "@/lib/auth/useSignInModal";

interface AddToHotlistPopoverProps {
  bookId: string;
  /** "button" renders the full CTA; "icon" renders a compact + icon */
  variant?: "button" | "icon";
  className?: string;
}

interface HotlistItem {
  id: string;
  name: string;
  shareSlug: string;
  bookCount: number;
}

export default function AddToHotlistPopover({
  bookId,
  variant = "button",
  className = "",
}: AddToHotlistPopoverProps) {
  const { user } = useAuth();
  const { openSignIn } = useSignInModal();
  const [open, setOpen] = useState(false);
  const [hotlists, setHotlists] = useState<HotlistItem[]>([]);
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect mobile (<=640px, matches Tailwind sm breakpoint)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Close on click outside (desktop) or on backdrop (mobile)
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setOpen(false);
  }, []);

  useEffect(() => {
    if (!open || isMobile) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, isMobile]);

  // Prevent body scroll when mobile sheet is open
  useEffect(() => {
    if (open && isMobile) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open, isMobile]);

  // Focus input when showing
  useEffect(() => {
    if (showNewInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showNewInput]);

  async function handleOpen() {
    if (!user) {
      openSignIn();
      return;
    }

    setLoading(true);
    setOpen(true);

    const supabase = createClient();

    // Fetch user's hotlists with book counts
    const { data: lists } = await supabase
      .from("hotlists")
      .select("id, name, share_slug, hotlist_books(count)")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    const mapped: HotlistItem[] = (lists ?? []).map((row: Record<string, unknown>) => {
      const countData = row.hotlist_books as { count: number }[] | undefined;
      return {
        id: row.id as string,
        name: row.name as string,
        shareSlug: row.share_slug as string,
        bookCount: countData?.[0]?.count ?? 0,
      };
    });

    setHotlists(mapped);

    // Check which lists already have this book
    if (mapped.length > 0) {
      const { data: existing } = await supabase
        .from("hotlist_books")
        .select("hotlist_id")
        .eq("book_id", bookId)
        .in("hotlist_id", mapped.map((h) => h.id));

      setAddedTo(new Set((existing ?? []).map((e: Record<string, unknown>) => e.hotlist_id as string)));
    }

    setLoading(false);
  }

  /** Trigger background enrichment if the book's ratings are missing or stale */
  function triggerEnrichmentIfNeeded() {
    const supabase = createClient();
    supabase
      .from("books")
      .select("id, title, author, isbn, data_refreshed_at")
      .eq("id", bookId)
      .single()
      .then(({ data: book }) => {
        if (!book) return;

        const staleMs = 24 * 60 * 60 * 1000;
        const isStale = !book.data_refreshed_at ||
          (Date.now() - new Date(book.data_refreshed_at).getTime() > staleMs);

        supabase
          .from("book_ratings")
          .select("id", { count: "exact", head: true })
          .eq("book_id", bookId)
          .then(({ count: ratingCount }) => {
            if (isStale || (ratingCount ?? 0) === 0) {
              fetch("/api/books/enrich", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  bookId: book.id,
                  title: book.title,
                  author: book.author,
                  isbn: book.isbn ?? undefined,
                }),
              }).catch(() => {});
            }
          });
      });
  }

  async function toggleBook(hotlistId: string) {
    try {
      const supabase = createClient();
      const isAdded = addedTo.has(hotlistId);

      if (isAdded) {
        // Remove
        await supabase
          .from("hotlist_books")
          .delete()
          .eq("hotlist_id", hotlistId)
          .eq("book_id", bookId);

        setAddedTo((prev) => {
          const next = new Set(prev);
          next.delete(hotlistId);
          return next;
        });
        setHotlists((prev) =>
          prev.map((h) => h.id === hotlistId ? { ...h, bookCount: h.bookCount - 1 } : h)
        );
      } else {
        // Add
        const { count } = await supabase
          .from("hotlist_books")
          .select("id", { count: "exact", head: true })
          .eq("hotlist_id", hotlistId);

        await supabase.from("hotlist_books").insert({
          hotlist_id: hotlistId,
          book_id: bookId,
          position: (count ?? 0) + 1,
        });

        await supabase
          .from("hotlists")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", hotlistId);

        setAddedTo((prev) => new Set([...Array.from(prev), hotlistId]));
        setHotlists((prev) =>
          prev.map((h) => h.id === hotlistId ? { ...h, bookCount: h.bookCount + 1 } : h)
        );

        // Trigger background enrichment for this book
        triggerEnrichmentIfNeeded();
      }
    } catch (err) {
      console.error("[toggleBook] failed:", err);
    }
  }

  async function handleCreate() {
    if (!user || !newName.trim()) return;
    setCreating(true);

    try {
      const supabase = createClient();
      const shareSlug = newName.trim().toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 30) + "-" + Math.random().toString(36).slice(2, 6);

      const { data: newList } = await supabase
        .from("hotlists")
        .insert({
          user_id: user.id,
          name: newName.trim(),
          is_public: false,
          share_slug: shareSlug,
        })
        .select("id, name")
        .single();

      if (newList) {
        // Add book to the new list immediately
        await supabase.from("hotlist_books").insert({
          hotlist_id: newList.id,
          book_id: bookId,
          position: 1,
        });

        setHotlists((prev) => [{ id: newList.id, name: newList.name, shareSlug: shareSlug, bookCount: 1 }, ...prev]);
        setAddedTo((prev) => new Set([...Array.from(prev), newList.id]));
        setNewName("");
        setShowNewInput(false);

        // Trigger background enrichment for this book
        triggerEnrichmentIfNeeded();
      }
    } catch (err) {
      console.error("[handleCreate] failed:", err);
    } finally {
      setCreating(false);
    }
  }

  const triggerButton = variant === "icon" ? (
    <button
      onClick={handleOpen}
      className={`w-8 h-8 flex items-center justify-center rounded-full border border-border bg-white text-muted hover:text-fire hover:border-fire/30 transition-colors ${className}`}
      title="Add to Hotlist"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="7" y1="2" x2="7" y2="12" />
        <line x1="2" y1="7" x2="12" y2="7" />
      </svg>
    </button>
  ) : (
    <button
      onClick={handleOpen}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-fire text-white font-body font-medium text-base px-6 min-h-[48px] hover:bg-fire/90 transition-colors w-full sm:w-auto ${className}`}
    >
      Add to Hotlist
    </button>
  );

  // Shared panel content (used in both desktop dropdown and mobile sheet)
  const panelContent = (
    <>
      <div className="p-3 border-b border-border flex items-center justify-between">
        <p className="text-xs font-mono text-muted uppercase tracking-wide">
          Add to hotlist
        </p>
        {isMobile && (
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink p-1">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-6 flex justify-center">
          <div className="w-5 h-5 border-2 border-fire border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="max-h-48 sm:max-h-48 overflow-y-auto">
            {hotlists.length === 0 && !showNewInput && (
              <p className="px-3 py-4 text-sm font-body text-muted/60 text-center">
                No hotlists yet. Create one below.
              </p>
            )}
            {hotlists.map((hl) => {
              const isIn = addedTo.has(hl.id);
              return (
                <div key={hl.id} className="flex items-center px-3 py-3 sm:py-2.5 transition-colors hover:bg-cream active:bg-cream">
                  <button
                    onClick={() => toggleBook(hl.id)}
                    className="flex-1 text-left flex items-center gap-2 min-w-0"
                  >
                    <span className="text-sm font-body text-ink truncate">{hl.name}</span>
                    <span className="text-xs font-mono text-muted shrink-0">
                      {hl.bookCount} {hl.bookCount === 1 ? "book" : "books"}
                    </span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {isIn && (
                      <>
                        <a
                          href={`/lists/${hl.shareSlug}`}
                          className="text-xs font-mono text-fire/70 hover:text-fire transition-colors"
                          onClick={() => setOpen(false)}
                        >
                          View
                        </a>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-fire">
                          <polyline points="3 8 7 12 13 4" />
                        </svg>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* New hotlist section */}
          <div className="p-3 border-t border-border">
            {showNewInput ? (
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="List name..."
                  className="flex-1 text-sm font-body border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-fire/50"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
                <button
                  onClick={handleCreate}
                  disabled={creating || !newName.trim()}
                  className="text-xs font-mono text-fire hover:text-fire/80 px-2 disabled:opacity-40"
                >
                  {creating ? "..." : "Create"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewInput(true)}
                className="w-full text-left text-sm font-mono text-fire hover:text-fire/80 transition-colors py-1"
              >
                + New Hotlist
              </button>
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <div className="relative" ref={popoverRef}>
      {triggerButton}

      {/* Desktop: dropdown popover */}
      {open && !isMobile && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-lg border border-border shadow-lg z-40 overflow-hidden">
          {panelContent}
        </div>
      )}

      {/* Mobile: bottom sheet via portal */}
      {open && isMobile && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={handleBackdropClick}
        >
          <div className="w-full max-w-lg bg-white rounded-t-2xl shadow-xl overflow-hidden animate-slide-up pb-safe">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            {panelContent}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
