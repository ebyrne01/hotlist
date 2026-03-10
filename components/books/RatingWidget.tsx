"use client";

import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clsx } from "clsx";

interface RatingWidgetProps {
  bookId: string;
  userId: string;
}

/**
 * Private note widget for the book detail page.
 * Star and spice ratings are handled by InlineUserRating and SpiceSection
 * respectively — this component only handles the private note field.
 */
export default function RatingWidget({ bookId, userId }: RatingWidgetProps) {
  const [note, setNote] = useState("");
  const [originalNote, setOriginalNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const supabase = createClient();

  // Load existing note
  useEffect(() => {
    supabase
      .from("user_ratings")
      .select("note")
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .single()
      .then(({ data }) => {
        if (data?.note) {
          setNote(data.note);
          setOriginalNote(data.note);
        }
        setLoaded(true);
      });
  }, [bookId, userId, supabase]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);

    try {
      await supabase.from("user_ratings").upsert(
        {
          user_id: userId,
          book_id: bookId,
          note: note.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,book_id" }
      );

      setOriginalNote(note.trim());
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (err) {
      console.error("[RatingWidget.handleSave] failed:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (saving) return;
    setSaving(true);

    try {
      await supabase
        .from("user_ratings")
        .update({ note: null, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("book_id", bookId);

      setNote("");
      setOriginalNote("");
    } catch (err) {
      console.error("[RatingWidget.handleClear] failed:", err);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  const hasChanges = note.trim() !== originalNote;

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <label
        htmlFor="private-note"
        className="text-[11px] font-mono text-muted/60 block mb-1.5"
      >
        Private Note (optional)
      </label>
      <textarea
        id="private-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Your reading notes — only you can see this"
        rows={3}
        className="w-full text-sm font-body text-ink border border-border rounded-md px-3 py-2 resize-none focus:outline-none focus:border-fire/50 bg-white placeholder:text-muted/40"
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={clsx(
            "text-xs font-mono px-3 py-1.5 rounded-md transition-colors",
            justSaved
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-fire text-white hover:bg-fire/90 disabled:opacity-40"
          )}
        >
          {justSaved ? (
            <span className="inline-flex items-center gap-1">
              <Check size={12} strokeWidth={3} /> Saved
            </span>
          ) : saving ? (
            "Saving..."
          ) : (
            "Save Note"
          )}
        </button>
        {originalNote && (
          <button
            onClick={handleClear}
            disabled={saving}
            className="text-xs font-mono text-muted/50 hover:text-fire transition-colors px-2 py-1.5"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
