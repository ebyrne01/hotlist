"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Flag } from "lucide-react";

type IssueType =
  | "wrong_edition"
  | "wrong_book"
  | "duplicate"
  | "junk_entry"
  | "foreign_edition"
  | "bad_synopsis"
  | "rating_accuracy"
  | "other";

const ISSUE_OPTIONS: { value: IssueType; label: string }[] = [
  { value: "wrong_edition", label: "Wrong edition" },
  { value: "rating_accuracy", label: "Rating inaccurate" },
  { value: "bad_synopsis", label: "Bad synopsis" },
  { value: "wrong_book", label: "Not romance / wrong genre" },
  { value: "duplicate", label: "Duplicate entry" },
  { value: "junk_entry", label: "Junk / not a book" },
  { value: "foreign_edition", label: "Foreign edition" },
  { value: "other", label: "Other" },
];

interface AdminBookFlagProps {
  bookId: string;
  bookTitle: string;
}

export default function AdminBookFlag({ bookId, bookTitle }: AdminBookFlagProps) {
  const { profile } = useAuth();
  const [state, setState] = useState<"idle" | "open" | "submitting" | "done">("idle");
  const [issueType, setIssueType] = useState<IssueType>("wrong_edition");
  const [notes, setNotes] = useState("");

  // Only render for admins
  if (!profile?.isAdmin) return null;

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-mono text-fire/70">
        <Flag size={12} /> Flagged
      </span>
    );
  }

  if (state === "idle") {
    return (
      <button
        onClick={() => setState("open")}
        className="inline-flex items-center gap-1 text-xs font-mono text-muted/50 hover:text-fire/70 transition-colors"
        title="Flag this book (admin)"
      >
        <Flag size={12} />
      </button>
    );
  }

  async function handleSubmit() {
    setState("submitting");
    try {
      const res = await fetch("/api/admin/quality/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, issueType, notes: notes.trim() || undefined }),
      });

      if (!res.ok) {
        // Fallback to direct insert if API fails
        const supabase = createClient();
        await supabase.from("quality_flags").insert({
          book_id: bookId,
          field_name: issueType === "other" ? "general" : issueType,
          issue_type: issueType === "other" ? "manual_flag" : issueType,
          source: "admin_manual",
          confidence: 1.0,
          original_value: notes.trim() || null,
          priority: "P1",
          auto_fixable: false,
          status: "open",
        });
      }

      setState("done");
    } catch {
      setState("done");
    }
  }

  return (
    <div className="inline-block relative">
      <div className="absolute top-0 left-0 z-50 bg-white border border-border rounded-lg shadow-lg p-3 w-72">
        <p className="text-xs font-mono text-muted/70 mb-2 truncate" title={bookTitle}>
          Flag: {bookTitle}
        </p>

        <div className="flex flex-wrap gap-1.5 mb-2">
          {ISSUE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setIssueType(opt.value)}
              className={`text-xs font-mono px-2 py-0.5 rounded-full border transition-colors ${
                issueType === opt.value
                  ? "border-fire/40 text-fire bg-fire/5"
                  : "border-border text-muted/70 hover:border-muted/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional) — what's wrong, what it should be..."
          rows={2}
          className="w-full text-xs font-body border border-border/50 rounded px-2 py-1.5 bg-white placeholder:text-muted/50 focus:outline-none focus:border-fire/30 resize-none"
        />

        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={handleSubmit}
            disabled={state === "submitting"}
            className="text-xs font-mono text-fire hover:text-fire/80 transition-colors disabled:opacity-50"
          >
            {state === "submitting" ? "Saving..." : "Flag"}
          </button>
          <button
            onClick={() => setState("idle")}
            className="text-xs font-mono text-muted/70 hover:text-muted/60 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      {/* Invisible anchor to keep layout stable */}
      <span className="inline-flex items-center gap-1 text-xs font-mono text-fire/70">
        <Flag size={12} />
      </span>
    </div>
  );
}
