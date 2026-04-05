export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getAdminClient } from "@/lib/supabase/admin";
import QuizWizard from "./QuizWizard";

export const metadata: Metadata = {
  title: "Build Your Reading DNA — Hotlist",
  description:
    "Take a 30-second quiz to discover your romance reading preferences. Get personalized book recommendations based on your favorite tropes and spice level.",
};

// Widely-known romance/romantasy titles for high quiz recognition rate
const CANONICAL_QUIZ_TITLES = new Set([
  // Romantasy
  "A Court of Thorns and Roses",
  "Fourth Wing",
  "Kingdom of the Wicked",
  "From Blood and Ash",
  "House of Earth and Blood",
  "The Cruel Prince",
  "Daughter of the Moon Goddess",
  // Contemporary
  "The Love Hypothesis",
  "Beach Read",
  "People We Meet on Vacation",
  "The Hating Game",
  "It Ends with Us",
  "Book Lovers",
  "The Spanish Love Deception",
  // Dark Romance
  "Twisted Love",
  "Haunting Adeline",
  "Den of Vipers",
  "Credence",
  // Historical / PNR
  "Outlander",
  "Ice Planet Barbarians",
  "A Hunger Like No Other",
  // Sports / RomCom
  "The Deal",
  "The Wall of Winnipeg and Me",
  "Act Your Age, Eve Brown",
  // Misc widely known
  "The Kiss Quotient",
  "Red, White & Royal Blue",
  "The Seven Husbands of Evelyn Hugo",
  "Priest",
  "Birthday Girl",
  "Ugly Love",
  "November 9",
  "Verity",
  "Things We Never Got Over",
  "Better Than the Movies",
]);

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

  // Fetch a broad pool of popular canon books with covers
  const { data: bookRows } = await supabase
    .from("books")
    .select("id, title, author, cover_url")
    .eq("is_canon", true)
    .not("cover_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(500);

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
  const allBooks = (bookRows ?? [])
    .filter((b) => {
      const t = bookTropeMap.get(b.id as string);
      return t && t.length > 0;
    })
    .map((b) => ({
      id: b.id as string,
      title: b.title as string,
      author: b.author as string,
      coverUrl: b.cover_url as string | null,
      tropes: bookTropeMap.get(b.id as string) ?? [],
    }));

  // Split: curated canonical titles first, then remaining popular books
  const canonicalTitlesLower = new Set(
    Array.from(CANONICAL_QUIZ_TITLES).map((t) => t.toLowerCase())
  );
  const canonical = allBooks.filter((b) =>
    canonicalTitlesLower.has(b.title.toLowerCase())
  );
  const nonCanonical = allBooks.filter(
    (b) => !canonicalTitlesLower.has(b.title.toLowerCase())
  );
  const candidateBooks = [...canonical, ...nonCanonical.slice(0, 60)];

  return <QuizWizard tropes={tropes} candidateBooks={candidateBooks} />;
}
