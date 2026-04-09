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
        <div className="text-4xl mb-4">📚</div>
        <h1 className="font-display text-2xl font-bold text-ink">
          Import from Goodreads
        </h1>
        <p className="text-sm font-body text-muted mt-3 max-w-md mx-auto">
          Upload your Goodreads export CSV and we&apos;ll match your books, map your
          ratings, and create your first Hotlist.
        </p>
      </div>

      <GoodreadsImporter />
    </div>
  );
}
