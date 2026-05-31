import type { Metadata } from "next";
import GoodreadsImporter from "@/components/onboarding/GoodreadsImporter";

export const metadata: Metadata = {
  title: "Import from Goodreads — Hotlist",
  description: "Upload your Goodreads export to import your reading history.",
};

export default function ImportPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fire">
          Power reader path
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">
          Bring your Goodreads shelves with you.
        </h1>
        <p className="text-sm font-body leading-6 text-muted-a11y mt-3 max-w-md mx-auto">
          Upload your Goodreads export CSV and we&apos;ll match your books, map your
          ratings, and create your first Hotlist.
        </p>
      </div>

      <GoodreadsImporter />
    </div>
  );
}
