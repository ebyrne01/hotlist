"use client";

import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSignInModal } from "@/lib/auth/useSignInModal";
import { clsx } from "clsx";
import type { ReadingStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: ReadingStatus; label: string }[] = [
  { value: "want_to_read", label: "Want to Read" },
  { value: "reading", label: "Reading" },
  { value: "read", label: "Read" },
];

interface ReadingStatusButtonsProps {
  bookId: string;
  bookTitle: string;
  /** Called when user marks the book as "Read" — used to show rating prompt */
  onMarkedRead?: () => void;
}

export default function ReadingStatusButtons({
  bookId,
  bookTitle,
  onMarkedRead,
}: ReadingStatusButtonsProps) {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [status, setStatus] = useState<ReadingStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const { openSignIn } = useSignInModal();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ id: data.user.id });
        supabase
          .from("reading_status")
          .select("status")
          .eq("user_id", data.user.id)
          .eq("book_id", bookId)
          .single()
          .then(({ data: rs }) => {
            if (rs) setStatus(rs.status as ReadingStatus);
          });
      }
    });
  }, [bookId, supabase]);

  async function handleStatusChange(newStatus: ReadingStatus) {
    if (!user) {
      openSignIn();
      return;
    }

    setSaving(true);
    const prevStatus = status;
    const isDeselect = status === newStatus;

    // Optimistic update
    setStatus(isDeselect ? null : newStatus);

    try {
      if (isDeselect) {
        await supabase
          .from("reading_status")
          .delete()
          .eq("user_id", user.id)
          .eq("book_id", bookId);
      } else {
        await supabase.from("reading_status").upsert(
          {
            user_id: user.id,
            book_id: bookId,
            status: newStatus,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,book_id" }
        );

        // Fire the "finished" callback when marking as Read
        if (newStatus === "read" && prevStatus !== "read" && onMarkedRead) {
          onMarkedRead();
        }
      }
    } catch (err) {
      console.error("[handleStatusChange] failed:", err);
      setStatus(prevStatus); // rollback
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full">
      <h3 className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
        Reading Status
      </h3>
      <div className="flex gap-1.5">
        {STATUS_OPTIONS.map((opt) => {
          const isActive = status === opt.value;
          const isRead = opt.value === "read" && isActive;

          return (
            <button
              key={opt.value}
              onClick={() => handleStatusChange(opt.value)}
              disabled={saving}
              className={clsx(
                "flex-1 inline-flex items-center justify-center gap-1 text-xs font-mono px-2 py-2 rounded-md border transition-colors",
                isActive
                  ? "bg-fire text-white border-fire"
                  : "bg-white text-muted border-border hover:border-fire/30 hover:text-ink",
                saving && "opacity-50"
              )}
            >
              {isRead && <Check size={12} strokeWidth={3} />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
