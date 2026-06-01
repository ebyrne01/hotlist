import Link from "next/link";
import type { BookDetail } from "@/lib/types";
import type { ReadingDnaRow } from "@/lib/reading-dna";
import { scoreBook } from "@/lib/reading-dna/score";

interface Props {
  book: BookDetail;
  dna: ReadingDnaRow | null;
  isSignedIn: boolean;
}

function spiceLabel(value: number) {
  if (value < 1.5) return "sweet";
  if (value < 2.5) return "mild";
  if (value < 3.5) return "medium heat";
  if (value < 4.5) return "hot";
  return "scorching";
}

function buildVerdict(book: BookDetail, dna: ReadingDnaRow) {
  const bookSpice = book.compositeSpice?.score ?? null;
  const matchedTropes = book.tropes
    .map((trope) => ({
      ...trope,
      affinity: dna.tropeAffinities[trope.slug] ?? 0,
    }))
    .filter((trope) => trope.affinity > 0)
    .sort((a, b) => b.affinity - a.affinity);

  const scored = scoreBook(
    {
      tropeAffinities: dna.tropeAffinities,
      spicePreferred: dna.spicePreferred,
      spiceTolerance: dna.spiceTolerance,
      signalCount: dna.signalCount,
    },
    {
      bookId: book.id,
      vector: Object.fromEntries(book.tropes.map((trope) => [trope.slug, 1])),
      spiceLevel: bookSpice,
    }
  );

  const spiceDiff = bookSpice == null ? null : Math.abs(bookSpice - dna.spicePreferred);
  const spiceAligned = spiceDiff == null || spiceDiff <= Math.max(dna.spiceTolerance, 0.8);
  const strongTropeMatch = matchedTropes.length >= 2 || scored.tropeOverlap >= 1.5;
  const someTropeMatch = matchedTropes.length >= 1 || scored.tropeOverlap > 0;

  const title = strongTropeMatch && spiceAligned
    ? "Likely your kind of hot."
    : someTropeMatch
      ? "There is something here for your lens."
      : "This may be more of a wild card for you.";

  const reasons: string[] = [];
  if (matchedTropes.length > 0) {
    reasons.push(
      `Strongest match: ${matchedTropes.slice(0, 3).map((trope) => trope.name).join(", ")}.`
    );
  } else if (book.tropes.length > 0) {
    reasons.push("Its main tropes are not major signals in your lens yet.");
  }

  if (bookSpice != null) {
    const diff = bookSpice - dna.spicePreferred;
    if (Math.abs(diff) <= Math.max(dna.spiceTolerance, 0.8)) {
      reasons.push(
        `Heat check: ${spiceLabel(bookSpice)} sits inside your usual zone.`
      );
    } else if (diff > 0) {
      reasons.push(
        `Heat check: spicier than your usual ${spiceLabel(dna.spicePreferred)} lane.`
      );
    } else {
      reasons.push(
        `Heat check: cooler than your usual ${spiceLabel(dna.spicePreferred)} lane.`
      );
    }
  } else {
    reasons.push("Heat check: we do not have enough spice signal yet.");
  }

  if (!strongTropeMatch && someTropeMatch) {
    reasons.push("Worth comparing beside another contender before you commit.");
  }

  return { title, reasons: reasons.slice(0, 3) };
}

export default function HotlistLensVerdict({ book, dna, isSignedIn }: Props) {
  if (!isSignedIn || !dna) {
    return (
      <section className="mt-4 rounded-2xl border border-fire/15 bg-fire/5 p-4 shadow-sm sm:p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fire">
          Your Hotlist lens
        </p>
        <h2 className="mt-1 font-display text-2xl font-bold text-ink">
          Want a personal verdict?
        </h2>
        <p className="mt-2 text-sm font-body leading-6 text-muted-a11y">
          Build your lens once, then Hotlist can judge whether books like this
          are your kind of hot.
        </p>
        <Link
          href="/reading/dna"
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-fire px-4 py-2 text-sm font-mono text-white transition-colors hover:bg-fire/90 sm:w-auto"
        >
          Build your Hotlist lens
        </Link>
      </section>
    );
  }

  const verdict = buildVerdict(book, dna);

  return (
    <section className="mt-4 rounded-2xl border border-aged-gold/30 bg-white p-4 shadow-sm sm:p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-aged-gold">
        Your Hotlist lens
      </p>
      <h2 className="mt-1 font-display text-2xl font-bold text-ink">
        {verdict.title}
      </h2>
      <ul className="mt-3 space-y-2">
        {verdict.reasons.map((reason) => (
          <li
            key={reason}
            className="rounded-xl border border-border/70 bg-cream px-3 py-2 text-sm font-body leading-6 text-muted-a11y"
          >
            {reason}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs font-mono leading-5 text-muted/70">
        Lens verdicts explain fit. Ratings, spice, and tropes still come from
        Hotlist&apos;s book data.
      </p>
    </section>
  );
}
