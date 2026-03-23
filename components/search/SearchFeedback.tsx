"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { clsx } from "clsx";

interface SearchFeedbackProps {
  analyticsId: string;
}

export default function SearchFeedback({ analyticsId }: SearchFeedbackProps) {
  const [submitted, setSubmitted] = useState<1 | -1 | null>(null);

  async function sendFeedback(feedback: 1 | -1) {
    setSubmitted(feedback);
    try {
      await fetch("/api/search/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsId, feedback }),
      });
    } catch {
      // Silent fail — feedback is best-effort
    }
  }

  if (submitted) {
    return (
      <span className="text-xs font-mono text-muted/50">
        {submitted === 1 ? "Thanks!" : "Thanks \u2014 we\u2019ll improve this."}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-mono text-muted/50">
      Did we get this right?
      <button
        onClick={() => sendFeedback(1)}
        className={clsx(
          "p-1 rounded hover:bg-green-50 hover:text-green-600 transition-colors",
          "text-muted/40"
        )}
        aria-label="Yes, good results"
      >
        <ThumbsUp size={14} />
      </button>
      <button
        onClick={() => sendFeedback(-1)}
        className={clsx(
          "p-1 rounded hover:bg-red-50 hover:text-red-500 transition-colors",
          "text-muted/40"
        )}
        aria-label="No, wrong results"
      >
        <ThumbsDown size={14} />
      </button>
    </span>
  );
}
