"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const DNF_TAGS = [
  { value: "too_slow", label: "Too slow" },
  { value: "wrong_spice", label: "Wrong spice level" },
  { value: "didnt_like_tropes", label: "Didn't like the tropes" },
  { value: "writing_style", label: "Writing style" },
  { value: "content_warnings", label: "Content warnings" },
  { value: "just_wasnt_for_me", label: "Just wasn't for me" },
] as const;

interface DnfReasonsProps {
  bookId: string;
  userId: string;
}

export default function DnfReasons({ bookId, userId }: DnfReasonsProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const supabase = createClient();

  // Load existing DNF reasons
  useEffect(() => {
    supabase
      .from("dnf_reasons")
      .select("tags, note")
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .single()
      .then(({ data }) => {
        if (data) {
          setSelectedTags(data.tags ?? []);
          setNote(data.note ?? "");
        }
      });
  }, [bookId, userId, supabase]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
    setSaved(false);
  }

  async function handleSave() {
    await supabase.from("dnf_reasons").upsert(
      {
        user_id: userId,
        book_id: bookId,
        tags: selectedTags,
        note: note.trim() || null,
      },
      { onConflict: "user_id,book_id" }
    );
    setSaved(true);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-mono text-muted uppercase tracking-wide">
        Why did you stop?
      </p>
      <div className="flex flex-wrap gap-1.5">
        {DNF_TAGS.map((tag) => {
          const active = selectedTags.includes(tag.value);
          return (
            <button
              key={tag.value}
              type="button"
              onClick={() => toggleTag(tag.value)}
              className={`px-2.5 py-1.5 rounded-full text-xs font-mono transition-colors border ${
                active
                  ? "bg-[#F5EFE0] border-[#D4B87A] text-[#6B5A2E]"
                  : "bg-white border-border text-muted hover:border-muted/40"
              }`}
            >
              {tag.label}
            </button>
          );
        })}
      </div>
      <textarea
        value={note}
        onChange={(e) => { setNote(e.target.value); setSaved(false); }}
        placeholder="Anything else? This is private."
        rows={2}
        className="w-full text-xs font-body border border-border rounded-lg px-3 py-2 bg-white text-ink placeholder:text-muted/40 focus:ring-2 focus:ring-fire/30 focus:border-fire/40 focus:outline-none resize-none"
      />
      <button
        type="button"
        onClick={handleSave}
        className="text-xs font-mono px-3 py-1.5 rounded-md bg-fire text-white hover:bg-fire/90 transition-colors"
      >
        {saved ? "Saved" : "Done"}
      </button>
    </div>
  );
}
