"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

const FEEDBACK_TYPES = [
  "Something felt confusing",
  "A book/result looked wrong",
  "I wanted a missing feature",
  "Tiny polish note",
];

export default function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState(FEEDBACK_TYPES[0]);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    setStatus("sending");
    try {
      const url = typeof window !== "undefined" ? window.location.href : "";
      await fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "feedback",
          referrer: url,
          metadata: {
            feedback_type: feedbackType,
            message: trimmedMessage,
            email: email.trim() || null,
            path:
              typeof window !== "undefined"
                ? `${window.location.pathname}${window.location.search}`
                : null,
          },
        }),
      });

      setStatus("sent");
      setMessage("");
      setEmail("");
      setTimeout(() => {
        setIsOpen(false);
        setStatus("idle");
      }, 1200);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="fixed bottom-20 right-3 z-50 sm:bottom-5 sm:right-5">
      {isOpen && (
        <div className="mb-3 w-[calc(100vw-1.5rem)] max-w-sm rounded-2xl border border-aged-gold/30 bg-white p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-lg font-bold text-ink">
                Send feedback
              </p>
              <p className="mt-1 text-sm font-body leading-5 text-muted-a11y">
                Tell us where the reading magic got bumpy. Every note helps us
                tune Hotlist for early testers.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-cream hover:text-ink"
              aria-label="Close feedback form"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">
                What kind of note?
              </span>
              <select
                value={feedbackType}
                onChange={(event) => setFeedbackType(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm font-body text-ink outline-none focus:border-fire/50 focus:ring-2 focus:ring-fire/20"
              >
                {FEEDBACK_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">
                Your note
              </span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                required
                maxLength={1200}
                rows={4}
                placeholder="What felt off, missing, confusing, or surprisingly good?"
                className="mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm font-body text-ink outline-none focus:border-fire/50 focus:ring-2 focus:ring-fire/20"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">
                Email, optional
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Only if you want a follow-up"
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm font-body text-ink outline-none focus:border-fire/50 focus:ring-2 focus:ring-fire/20"
              />
            </label>

            <button
              type="submit"
              disabled={status === "sending"}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-fire px-4 py-2.5 font-mono text-xs uppercase tracking-[0.16em] text-white transition-colors hover:bg-fire/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "sending"
                ? "Sending..."
                : status === "sent"
                  ? "Sent. Thank you!"
                  : "Send note"}
            </button>

            {status === "error" && (
              <p className="text-sm font-body text-fire" role="status">
                Could not send that note. Please try once more.
              </p>
            )}
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-fire/25 bg-ink px-4 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-cream shadow-xl transition-colors hover:bg-fire"
        aria-expanded={isOpen}
      >
        <MessageCircle size={15} aria-hidden="true" />
        Feedback
      </button>
    </div>
  );
}
