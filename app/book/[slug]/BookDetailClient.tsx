"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import AddToHotlistPopover from "@/components/hotlists/AddToHotlistPopover";
import type { ReadingStatus } from "@/lib/types";

interface BookDetailClientProps {
  section: "reading-status" | "add-to-hotlist" | "mobile-cta";
  bookId: string;
  bookTitle?: string;
}

export default function BookDetailClient({
  section,
  bookId,
}: BookDetailClientProps) {
  switch (section) {
    case "reading-status":
      return <ReadingStatusSection bookId={bookId} />;
    case "add-to-hotlist":
      return <AddToHotlistPopover bookId={bookId} variant="button" />;
    case "mobile-cta":
      return <AddToHotlistPopover bookId={bookId} variant="button" className="w-full" />;
  }
}

// ── Reading Status ───────────────────────────────────

const STATUS_OPTIONS: { value: ReadingStatus; label: string }[] = [
  { value: "want_to_read", label: "Want to Read" },
  { value: "reading", label: "Reading" },
  { value: "read", label: "Read" },
];

function ReadingStatusSection({ bookId }: { bookId: string }) {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [status, setStatus] = useState<ReadingStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ id: data.user.id });
        // Fetch current status
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

  if (!user) return null;

  async function handleStatusChange(newStatus: ReadingStatus) {
    if (!user) return;
    setSaving(true);
    const isDeselect = status === newStatus;

    if (isDeselect) {
      await supabase
        .from("reading_status")
        .delete()
        .eq("user_id", user.id)
        .eq("book_id", bookId);
      setStatus(null);
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
      setStatus(newStatus);
    }
    setSaving(false);
  }

  return (
    <div className="w-full">
      <h3 className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
        Reading Status
      </h3>
      <div className="flex gap-1.5">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleStatusChange(opt.value)}
            disabled={saving}
            className={`flex-1 text-xs font-mono px-2 py-2 rounded-md border transition-colors ${
              status === opt.value
                ? "bg-fire text-white border-fire"
                : "bg-white text-muted border-border hover:border-fire/30"
            } ${saving ? "opacity-50" : ""}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

