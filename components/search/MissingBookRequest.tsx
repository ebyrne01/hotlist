"use client";

import { useState } from "react";
import { Loader2, PlusCircle } from "lucide-react";

interface MissingBookRequestProps {
  initialTitle: string;
}

export default function MissingBookRequest({
  initialTitle,
}: MissingBookRequestProps) {
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage("");

    try {
      const response = await fetch("/api/books/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          author,
          sourceUrl,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Could not save that request.");
      }

      const resolution = data.resolution as
        | { status?: string; reason?: string }
        | null
        | undefined;
      setStatus("success");
      setMessage(
        resolution?.status === "resolved"
          ? "Got it. We found enough metadata to queue this book for enrichment."
          : "Got it. We will use that link to prioritize this book for enrichment."
      );
      setSourceUrl("");
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Could not save that request."
      );
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-fire/20 bg-white p-4 text-left shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-fire/10 p-2 text-fire">
          <PlusCircle size={18} aria-hidden="true" />
        </div>
        <div>
          <p className="font-display text-lg font-bold text-ink">
            Help us add this book
          </p>
          <p className="mt-1 text-sm font-body text-muted">
            Paste a Goodreads, Amazon, romance.io, StoryGraph, or publisher
            link. We will use it as a demand signal and queue the book for
            review.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">
            Book title
          </span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={180}
            required
            className="mt-1 min-h-11 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm font-body text-ink outline-none focus:border-fire/50 focus:ring-2 focus:ring-fire/20"
          />
        </label>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">
            Author, if you know it
          </span>
          <input
            type="text"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            maxLength={120}
            className="mt-1 min-h-11 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm font-body text-ink outline-none focus:border-fire/50 focus:ring-2 focus:ring-fire/20"
          />
        </label>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">
            Book URL
          </span>
          <input
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://www.goodreads.com/book/show/..."
            maxLength={600}
            required
            className="mt-1 min-h-11 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm font-body text-ink outline-none focus:border-fire/50 focus:ring-2 focus:ring-fire/20"
          />
          <span className="mt-1 block text-xs font-body text-muted/70">
            A source link helps us avoid the wrong edition or duplicate title.
          </span>
        </label>

        <button
          type="submit"
          disabled={status === "submitting"}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-fire px-4 py-2.5 font-mono text-xs uppercase tracking-[0.16em] text-white transition-colors hover:bg-fire/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "submitting" && (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          )}
          {status === "submitting" ? "Saving..." : "Request this book"}
        </button>

        {message && (
          <p
            className={
              status === "success"
                ? "text-sm font-body text-green-700"
                : "text-sm font-body text-fire"
            }
            role="status"
          >
            {message}
          </p>
        )}
      </form>
    </div>
  );
}
