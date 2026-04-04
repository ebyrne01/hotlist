"use client";

import { useState, useEffect } from "react";
import ExpandableText from "@/components/ui/ExpandableText";

interface OnDemandSynopsisProps {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  description: string;
  goodreadsId: string | null;
}

function cleanSynopsis(text: string, title: string, author: string): string {
  let cleaned = text
    .replace(/^[#*>\-–—]+\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^[""\u201C]|[""\u201D]$/g, "")
    .replace(/^"|"$/g, "")
    .trim();

  const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixPattern = new RegExp(
    `^${escaped(title)}\\s+by\\s+${escaped(author)}[\\s:.,;—–\\-]*`,
    "i"
  );
  cleaned = cleaned.replace(prefixPattern, "").trim();
  return cleaned;
}

export default function OnDemandSynopsis({
  bookId,
  bookTitle,
  bookAuthor,
  description,
  goodreadsId,
}: OnDemandSynopsisProps) {
  const [synopsis, setSynopsis] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchSynopsis() {
      try {
        const res = await fetch("/api/books/synopsis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId }),
        });

        if (!res.ok || cancelled) return;

        const data = await res.json();
        if (!cancelled && data.synopsis) {
          setSynopsis(data.synopsis);
        } else if (!cancelled) {
          setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSynopsis();
    return () => { cancelled = true; };
  }, [bookId]);

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-4 bg-border/40 rounded w-full" />
        <div className="h-4 bg-border/40 rounded w-11/12" />
        <div className="h-4 bg-border/40 rounded w-9/12" />
        <span className="inline-block mt-1 text-[10px] font-mono text-muted-a11y/60">
          Generating synopsis...
        </span>
      </div>
    );
  }

  if (failed || !synopsis) {
    return (
      <div>
        <p className="font-body text-ink/80 text-sm leading-relaxed">
          {description}
        </p>
        {goodreadsId && (
          <a
            href={`https://www.goodreads.com/book/show/${goodreadsId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 text-xs font-mono text-muted-a11y hover:text-fire transition-colors"
          >
            Description from Goodreads {"\u2197"}
          </a>
        )}
      </div>
    );
  }

  return (
    <div>
      <ExpandableText
        text={cleanSynopsis(synopsis, bookTitle, bookAuthor)}
        hookLine
        maxLines={3}
        className="font-body text-ink/90 leading-[1.85]"
        style={{ fontSize: "0.95rem" }}
      />
      <span className="inline-block mt-1 text-[10px] font-mono text-muted-a11y/60">
        AI-generated synopsis
      </span>
    </div>
  );
}
