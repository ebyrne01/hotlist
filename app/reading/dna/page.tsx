export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getAdminClient } from "@/lib/supabase/admin";
import QuizWizard from "./QuizWizard";

export const metadata: Metadata = {
  title: "Build Your Reading DNA — Hotlist",
  description:
    "Take a 30-second quiz to discover your romance reading preferences. Get personalized book recommendations based on your favorite tropes and spice level.",
};

export default async function ReadingDnaPage() {
  const supabase = getAdminClient();

  // Load all canonical tropes sorted by popularity (sort_order)
  const { data: tropeRows } = await supabase
    .from("tropes")
    .select("slug, name")
    .order("sort_order", { ascending: true });

  const tropes = (tropeRows ?? []).map((t) => ({
    slug: t.slug as string,
    name: t.name as string,
  }));

  // Load popular canon books with covers for the book pick step.
  // Fetch books that have tropes and good covers, sorted by rating count.
  const { data: bookRows } = await supabase
    .from("books")
    .select("id, title, author, cover_url")
    .eq("is_canon", true)
    .not("cover_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  // Get trope mappings for these books
  const bookIds = (bookRows ?? []).map((b) => b.id as string);
  const { data: btRows } = await supabase
    .from("book_tropes")
    .select("book_id, tropes(slug)")
    .in("book_id", bookIds);

  // Build trope lookup per book
  const bookTropeMap = new Map<string, string[]>();
  for (const bt of (btRows ?? []) as Record<string, unknown>[]) {
    const bookId = bt.book_id as string;
    const tropeData = bt.tropes as { slug: string } | null;
    if (!tropeData) continue;
    const list = bookTropeMap.get(bookId) ?? [];
    list.push(tropeData.slug);
    bookTropeMap.set(bookId, list);
  }

  // Only include books that have at least one trope
  const candidateBooks = (bookRows ?? [])
    .filter((b) => {
      const tropes = bookTropeMap.get(b.id as string);
      return tropes && tropes.length > 0;
    })
    .map((b) => ({
      id: b.id as string,
      title: b.title as string,
      author: b.author as string,
      coverUrl: b.cover_url as string | null,
      tropes: bookTropeMap.get(b.id as string) ?? [],
    }));

  return <QuizWizard tropes={tropes} candidateBooks={candidateBooks} />;
}
