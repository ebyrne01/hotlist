"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";

type FeedbackType = "wrong_book" | "wrong_edition";

interface GrabFeedbackButtonProps {
  videoUrl: string;
  bookId?: string;
  bookTitle: string;
  feedbackOptions: FeedbackType[];
}

const LABELS: Record<FeedbackType, string> = {
  wrong_book: "Wrong book",
  wrong_edition: "Wrong edition",
};

export default function GrabFeedbackButton({
  videoUrl,
  bookId,
  bookTitle,
  feedbackOptions,
}: GrabFeedbackButtonProps) {
  const [state, setState] = useState<"collapsed" | "expanded" | "submitted">("collapsed");
  const [selectedType, setSelectedType] = useState<FeedbackType>(feedbackOptions[0]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();

  if (state === "submitted") {
    return (
      <p className="text-xs font-mono text-muted/70 italic mt-1">
        Thanks, we&apos;ll look into it!
      </p>
    );
  }

  if (state === "collapsed") {
    return (
      <button
        onClick={() => setState("expanded")}
        className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-mono text-muted/70 transition-colors hover:bg-cream hover:text-ink"
      >
        Not right?
      </button>
    );
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const supabase = createClient();
      await supabase.from("grab_feedback").insert({
        video_url: videoUrl,
        book_id: bookId ?? null,
        book_title: bookTitle,
        feedback_type: selectedType,
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
    <div className="border-t border-border/30 mt-2 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        {feedbackOptions.map((opt) => (
          <button
            key={opt}
            onClick={() => setSelectedType(opt)}
            className={`min-h-9 rounded-full border px-3 py-1 text-xs font-mono transition-colors ${
              selectedType === opt
                ? "border-fire/40 text-fire bg-fire/5"
                : "border-border text-muted/70 hover:border-muted/30"
            }`}
          >
            {LABELS[opt]}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What should it be? (optional)"
        className="mt-2 min-h-11 w-full rounded-lg border border-border/50 bg-white px-3 py-2 text-sm font-body placeholder:text-muted/70 focus:border-fire/30 focus:outline-none"
        onKeyDown={(e) => e.key === "Enter" && !submitting && handleSubmit()}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex min-h-10 items-center rounded-lg px-3 text-xs font-mono text-fire transition-colors hover:bg-fire/5 hover:text-fire/80 disabled:opacity-50"
        >
          {submitting ? "Sending..." : "Send"}
        </button>
        <button
          onClick={() => setState("collapsed")}
          className="inline-flex min-h-10 items-center rounded-lg px-3 text-xs font-mono text-muted/70 transition-colors hover:bg-cream hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
