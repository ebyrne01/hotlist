"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSignInModal } from "@/lib/auth/useSignInModal";
import Button from "@/components/ui/Button";
import SpiceStep from "./SpiceStep";
import TropeStep from "./TropeStep";
import BookPickStep from "./BookPickStep";
import DislikedBooksStep from "./DislikedBooksStep";
import ContentWarningStep from "./ContentWarningStep";

interface CandidateBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  tropes: string[]; // trope slugs
}

interface QuizWizardProps {
  tropes: { slug: string; name: string }[];
  candidateBooks: CandidateBook[];
}

type Step = "spice" | "tropes" | "books" | "disliked" | "warnings";
const STEPS: Step[] = ["spice", "tropes", "books", "disliked", "warnings"];
const MIN_TROPES = 3;
const MIN_BOOKS = 3;

export default function QuizWizard({ tropes, candidateBooks }: QuizWizardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { openSignIn } = useSignInModal();

  const [step, setStep] = useState<Step>("spice");
  const [spiceLevel, setSpiceLevel] = useState<number | null>(null);
  const [selectedTropes, setSelectedTropes] = useState<Set<string>>(new Set());
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());
  const [dislikedBooks, setDislikedBooks] = useState<Set<string>>(new Set());
  const [selectedWarnings, setSelectedWarnings] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.indexOf(step);

  const toggleTrope = useCallback((slug: string) => {
    setSelectedTropes((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const toggleBook = useCallback((bookId: string) => {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }, []);

  const toggleDisliked = useCallback((bookId: string) => {
    setDislikedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }, []);

  const toggleWarning = useCallback((cw: string) => {
    setSelectedWarnings((prev) => {
      const next = new Set(prev);
      if (next.has(cw)) next.delete(cw);
      else next.add(cw);
      return next;
    });
  }, []);

  // Filter candidate books by selected tropes
  const filteredBooks = candidateBooks.filter((book) =>
    book.tropes.some((t) => selectedTropes.has(t))
  );

  const canAdvance = () => {
    if (step === "spice") return spiceLevel !== null;
    if (step === "tropes") return selectedTropes.size >= MIN_TROPES;
    if (step === "books") return selectedBooks.size >= MIN_BOOKS;
    if (step === "disliked") return true; // Optional step
    if (step === "warnings") return true; // Optional step
    return false;
  };

  const handleNext = () => {
    if (step === "spice") {
      setStep("tropes");
    } else if (step === "tropes") {
      setSelectedBooks(new Set());
      setStep("books");
    } else if (step === "books") {
      setStep("disliked");
    } else if (step === "disliked") {
      setStep("warnings");
    }
  };

  const handleBack = () => {
    if (step === "tropes") setStep("spice");
    else if (step === "books") setStep("tropes");
    else if (step === "disliked") setStep("books");
    else if (step === "warnings") setStep("disliked");
  };

  const handleSave = async () => {
    if (!user) {
      openSignIn(() => handleSave());
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/reading-dna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spiceLevel,
          tropeSelections: Array.from(selectedTropes),
          bookSelections: Array.from(selectedBooks),
          dislikedBooks: Array.from(dislikedBooks),
          cwPreferences: Array.from(selectedWarnings),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Failed to save your Reading DNA");
      }

      router.push("/reading/dna/results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const isOptionalStep = step === "disliked" || step === "warnings";
  const isFinalStep = step === "warnings";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-8 max-w-xs mx-auto">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= stepIndex ? "bg-fire" : "bg-border"
            }`}
          />
        ))}
      </div>

      {/* Step content */}
      {step === "spice" && (
        <SpiceStep selected={spiceLevel} onSelect={setSpiceLevel} />
      )}
      {step === "tropes" && (
        <TropeStep
          tropes={tropes}
          selected={selectedTropes}
          onToggle={toggleTrope}
        />
      )}
      {step === "books" && (
        <BookPickStep
          books={filteredBooks}
          selected={selectedBooks}
          onToggle={toggleBook}
        />
      )}
      {step === "disliked" && (
        <DislikedBooksStep
          books={candidateBooks}
          lovedIds={selectedBooks}
          selected={dislikedBooks}
          onToggle={toggleDisliked}
        />
      )}
      {step === "warnings" && (
        <ContentWarningStep
          selected={selectedWarnings}
          onToggle={toggleWarning}
        />
      )}

      {/* Error */}
      {error && (
        <p className="text-center text-sm text-status-error font-body mt-4">
          {error}
        </p>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8 max-w-md mx-auto">
        {stepIndex > 0 ? (
          <Button variant="ghost" size="sm" onClick={handleBack}>
            Back
          </Button>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2">
          {/* Skip button for optional steps */}
          {isOptionalStep && !isFinalStep && (
            <Button variant="ghost" size="sm" onClick={handleNext}>
              Skip
            </Button>
          )}
          {isFinalStep && (
            <Button variant="ghost" size="sm" onClick={handleSave} disabled={saving}>
              Skip
            </Button>
          )}

          {isFinalStep ? (
            <Button
              variant="primary"
              size="md"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Building your DNA..." : "Build My Reading DNA"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={handleNext}
              disabled={!canAdvance()}
            >
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
