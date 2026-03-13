"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";

interface MissingBookFeedbackProps {
  videoUrl: string;
}

export default function MissingBookFeedback({ videoUrl }: MissingBookFeedbackProps) {
  const [state, setState] = useState<"collapsed" | "expanded" | "submitted">("collapsed");
  const [bookTitle, setBookTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();

  if (state === "submitted") {
    return (
      <div className="mt-4 p-3 border border-dashed border-border/50 rounded-lg text-center">
        <p className="text-xs font-mono text-muted/50 italic">
          Thanks for helping us get smarter! Your feedback improves results for everyone.
        </p>
      </div>
    );
  }

  if (state === "collapsed") {
    return (
      <div className="mt-4 text-center">
        <button
          onClick={() => setState("expanded")}
          className="text-xs font-mono text-muted/40 hover:text-muted/60 transition-colors"
        >
          Missing a book from this video?
        </button>
      </div>
    );
  }

  async function handleSubmit() {
    if (!bookTitle.trim()) return;
    setSubmitting(true);
    try {
      const supabase = createClient();
      await supabase.from("grab_feedback").insert({
        video_url: videoUrl,
        book_id: null,
        book_title: bookTitle.trim(),
        feedback_type: "missing_book",
        notes: notes.trim() || null,
        user_id: user?.id ?? null,
      });
      setState("submitted");
    } catch {
      setState("submitted");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 p-3 border border-dashed border-border/50 rounded-lg">
      <p className="text-xs font-mono text-muted/60 mb-2">
        Missing a book from this video?
      </p>
      <input
        type="text"
        value={bookTitle}
        onChange={(e) => setBookTitle(e.target.value)}
        placeholder="Book title and author"
        className="w-full text-sm font-body border border-border/50 rounded px-3 py-1.5 bg-white placeholder:text-muted/30 focus:outline-none focus:border-fire/30"
      />
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Any other details? (optional)"
        className="mt-1.5 w-full text-[11px] font-body border border-border/50 rounded px-3 py-1.5 bg-white placeholder:text-muted/30 focus:outline-none focus:border-fire/30"
        onKeyDown={(e) => e.key === "Enter" && !submitting && handleSubmit()}
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSubmit}
          disabled={submitting || !bookTitle.trim()}
          className="text-xs font-mono text-fire hover:text-fire/80 transition-colors disabled:opacity-50"
        >
          {submitting ? "Sending..." : "Send"}
        </button>
        <button
          onClick={() => setState("collapsed")}
          className="text-xs font-mono text-muted/40 hover:text-muted/60 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
