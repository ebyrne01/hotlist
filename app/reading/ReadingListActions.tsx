"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface ReadingListActionsProps {
  bookId: string;
  tab: string;
}

export default function ReadingListActions({ bookId }: ReadingListActionsProps) {
  const [removing, setRemoving] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleRemove() {
    setRemoving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from("reading_status")
        .delete()
        .eq("user_id", user.id)
        .eq("book_id", bookId);

      // Refresh the page to reflect removal
      router.refresh();
    } catch (err) {
      console.error("[handleRemove] failed:", err);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <button
      onClick={handleRemove}
      disabled={removing}
      className="shrink-0 text-muted/30 hover:text-fire transition-colors p-1 opacity-0 group-hover:opacity-100"
      title="Remove from shelf"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="3" y1="3" x2="11" y2="11" />
        <line x1="11" y1="3" x2="3" y2="11" />
      </svg>
    </button>
  );
}
