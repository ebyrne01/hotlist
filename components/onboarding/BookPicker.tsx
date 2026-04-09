"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { ReaderResponse } from "@/lib/types";
import { useSignInModal } from "@/lib/auth/useSignInModal";

interface PickerBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  slug: string;
}

const PRE_READ_OPTIONS: { response: ReaderResponse; label: string; emoji: string }[] = [
  { response: "must_read", label: "Must Read", emoji: "🔥" },
  { response: "on_the_shelf", label: "Shelf", emoji: "📚" },
  { response: "not_for_me", label: "Pass", emoji: "🤷" },
];

const POST_READ_OPTIONS: { response: ReaderResponse; label: string; emoji: string }[] = [
  { response: "loved_it", label: "Loved It", emoji: "❤️" },
  { response: "it_was_fine", label: "Fine", emoji: "👍" },
  { response: "didnt_finish", label: "DNF", emoji: "💬" },
];

const MIN_RESPONSES = 10;

export default function BookPicker({ books }: { books: PickerBook[] }) {
  const router = useRouter();
  const { openSignIn } = useSignInModal();
  const [responses, setResponses] = useState<Map<string, ReaderResponse>>(new Map());
  const [showPostRead, setShowPostRead] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const responseCount = responses.size;
  const canContinue = responseCount >= MIN_RESPONSES;
  const progress = Math.min(responseCount / MIN_RESPONSES, 1);

  function handleResponse(bookId: string, response: ReaderResponse) {
    setResponses((prev) => {
      const next = new Map(prev);
      // Toggle off if already selected
      if (next.get(bookId) === response) {
        next.delete(bookId);
      } else {
        next.set(bookId, response);
      }
      return next;
    });
  }

  function togglePostRead(bookId: string) {
    setShowPostRead((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) {
        next.delete(bookId);
      } else {
        next.add(bookId);
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (!canContinue || submitting) return;
    setSubmitting(true);

    try {
      const payload = Array.from(responses.entries()).map(([bookId, response]) => ({
        bookId,
        response,
      }));

      const res = await fetch("/api/get-started/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: payload }),
      });

      if (res.status === 401) {
        openSignIn();
        setSubmitting(false);
        return;
      }

      if (!res.ok) {
        console.warn("Failed to submit responses:", await res.text());
        setSubmitting(false);
        return;
      }

      const data = await res.json();
      // Redirect to their new hotlist or DNA progress
      if (data.hotlistId) {
        router.push(`/lists/${data.hotlistId}`);
      } else {
        router.push("/reading");
      }
    } catch (err) {
      console.warn("Submit error:", err);
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Progress bar */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-border px-4 py-3 -mx-4 mb-6">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-mono text-ink">
            {responseCount} of {MIN_RESPONSES} books rated
          </span>
          {canContinue && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="text-sm font-mono px-4 py-1.5 rounded-full bg-fire text-white hover:bg-fire/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Continue →"}
            </button>
          )}
        </div>
        <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-fire rounded-full transition-all duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* Book grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 sm:gap-5">
        {books.map((book) => {
          const currentResponse = responses.get(book.id);
          const isPostRead = showPostRead.has(book.id);
          const options = isPostRead ? POST_READ_OPTIONS : PRE_READ_OPTIONS;

          return (
            <div key={book.id} className="flex flex-col items-center">
              {/* Cover */}
              <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden shadow-sm mb-2">
                <Image
                  src={book.coverUrl}
                  alt={book.title}
                  fill
                  sizes="(max-width: 640px) 30vw, 20vw"
                  className="object-cover"
                />
                {currentResponse && (
                  <div className="absolute inset-0 bg-fire/10 border-2 border-fire rounded-lg" />
                )}
              </div>

              {/* Title + Author */}
              <p className="text-xs font-body text-ink font-medium text-center line-clamp-2 leading-tight">
                {book.title}
              </p>
              <p className="text-[10px] font-mono text-muted/60 text-center truncate w-full">
                {book.author}
              </p>

              {/* Response buttons */}
              <div className="flex gap-1 mt-1.5">
                {options.map((opt) => {
                  const isActive = currentResponse === opt.response;
                  return (
                    <button
                      key={opt.response}
                      onClick={() => handleResponse(book.id, opt.response)}
                      title={opt.label}
                      className={`text-xs px-1.5 py-1 rounded-md border transition-all ${
                        isActive
                          ? "border-fire bg-fire/10 text-fire"
                          : "border-border text-muted/60 hover:border-muted/40"
                      }`}
                    >
                      {opt.emoji}
                    </button>
                  );
                })}
              </div>

              {/* Toggle pre/post-read */}
              <button
                onClick={() => togglePostRead(book.id)}
                className="text-[10px] font-mono text-muted/40 hover:text-fire transition-colors mt-1"
              >
                {isPostRead ? "haven't read" : "I've read this"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Bottom CTA for mobile */}
      {canContinue && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-border px-4 py-3">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full text-sm font-mono py-3 rounded-full bg-fire text-white hover:bg-fire/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Saving..." : `Continue with ${responseCount} picks →`}
          </button>
        </div>
      )}
    </div>
  );
}
