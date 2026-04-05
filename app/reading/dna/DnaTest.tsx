"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSignInModal } from "@/lib/auth/useSignInModal";
import Button from "@/components/ui/Button";
import SubgenreStep from "./SubgenreStep";
import SpiceStep from "./SpiceStep";
import TropeStep from "./TropeStep";
import BookPickStep, { type CandidateBook } from "./BookPickStep";
import DislikedBooksStep from "./DislikedBooksStep";
import ContentWarningStep from "./ContentWarningStep";

interface DnaTestProps {
  tropes: { slug: string; name: string }[];
}

type Step = "subgenre" | "spice" | "tropes" | "books" | "disliked" | "warnings";
const STEPS: Step[] = ["subgenre", "spice", "tropes", "books", "disliked", "warnings"];
const MIN_TROPES = 3;
const MIN_BOOKS = 3;
const STORAGE_KEY = "dna_test_draft";

interface DraftState {
  step: Step;
  subgenres: string[];
  spiceLevels: number[];
  tropes: string[];
  books: string[];
  dislikedBooks: string[];
  warnings: string[];
}

function saveDraft(state: DraftState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage unavailable (SSR, private browsing quota)
  }
}

function loadDraft(): DraftState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DraftState;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export default function DnaTest({ tropes }: DnaTestProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { openSignIn } = useSignInModal();

  // Restore draft from sessionStorage (survives OAuth redirect)
  const draft = useRef(loadDraft());
  const [step, setStep] = useState<Step>(draft.current?.step ?? "subgenre");
  const [selectedSubgenres, setSelectedSubgenres] = useState<Set<string>>(
    new Set(draft.current?.subgenres)
  );
  const [spiceLevels, setSpiceLevels] = useState<Set<number>>(
    new Set(draft.current?.spiceLevels)
  );
  const [selectedTropes, setSelectedTropes] = useState<Set<string>>(
    new Set(draft.current?.tropes)
  );
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(
    new Set(draft.current?.books)
  );
  const [dislikedBooks, setDislikedBooks] = useState<Set<string>>(
    new Set(draft.current?.dislikedBooks)
  );
  const [selectedWarnings, setSelectedWarnings] = useState<Set<string>>(
    new Set(draft.current?.warnings)
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [pickedBookData, setPickedBookData] = useState<CandidateBook[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-save after returning from OAuth if user is now signed in and draft exists
  const autoSaveTriggered = useRef(false);
  useEffect(() => {
    if (user && draft.current && !autoSaveTriggered.current) {
      autoSaveTriggered.current = true;
      // User just signed in and we have a draft — auto-submit
      handleSave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const stepIndex = STEPS.indexOf(step);

  const toggleSubgenre = useCallback((slug: string) => {
    setSelectedSubgenres((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const toggleSpice = useCallback((level: number) => {
    setSpiceLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

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

  const canAdvance = () => {
    if (step === "subgenre") return selectedSubgenres.size >= 1;
    if (step === "spice") return spiceLevels.size >= 1;
    if (step === "tropes") return selectedTropes.size >= MIN_TROPES;
    if (step === "books") return selectedBooks.size >= MIN_BOOKS;
    if (step === "disliked") return true;
    if (step === "warnings") return true;
    return false;
  };

  const handleNext = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) {
      if (step === "tropes") {
        setSelectedBooks(new Set());
      }
      setStep(STEPS[idx + 1]);
    }
  };

  const handleBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) {
      setStep(STEPS[idx - 1]);
    }
  };

  const handleSave = async () => {
    if (!user) {
      // Persist state before OAuth redirect
      saveDraft({
        step,
        subgenres: Array.from(selectedSubgenres),
        spiceLevels: Array.from(spiceLevels),
        tropes: Array.from(selectedTropes),
        books: Array.from(selectedBooks),
        dislikedBooks: Array.from(dislikedBooks),
        warnings: Array.from(selectedWarnings),
      });
      openSignIn();
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/reading-dna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subgenrePreferences: Array.from(selectedSubgenres),
          spiceLevels: Array.from(spiceLevels),
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

      clearDraft();
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
      {step === "subgenre" && (
        <SubgenreStep
          selected={selectedSubgenres}
          onToggle={toggleSubgenre}
        />
      )}
      {step === "spice" && (
        <SpiceStep selected={spiceLevels} onToggle={toggleSpice} />
      )}
      {step === "tropes" && (
        <TropeStep
          tropes={tropes}
          selected={selectedTropes}
          onToggle={toggleTrope}
          subgenres={selectedSubgenres}
        />
      )}
      {step === "books" && (
        <BookPickStep
          selected={selectedBooks}
          onToggle={toggleBook}
          subgenres={selectedSubgenres}
          onPickedBooksChange={setPickedBookData}
        />
      )}
      {step === "disliked" && (
        <DislikedBooksStep
          lovedIds={selectedBooks}
          selected={dislikedBooks}
          onToggle={toggleDisliked}
          subgenres={selectedSubgenres}
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
