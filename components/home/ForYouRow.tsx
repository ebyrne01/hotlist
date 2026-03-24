"use client";

import BookRow from "@/components/books/BookRow";
import type { BookDetail } from "@/lib/types";
import { Dna } from "lucide-react";

interface ForYouRowProps {
  books: BookDetail[];
}

export default function ForYouRow({ books }: ForYouRowProps) {
  if (books.length === 0) return null;

  return (
    <section className="py-8">
      <h2 className="heading-section flex items-center gap-2 mb-4">
        <Dna size={20} className="text-fire" aria-hidden="true" />
        For You
      </h2>
      <p className="text-xs font-body text-muted mb-3">
        Based on your Reading DNA
      </p>
      <BookRow books={books} />
    </section>
  );
}
