import { NextRequest, NextResponse } from "next/server";
import { findBook } from "@/lib/books";

const SEED_TITLES = [
  "Beach Read Emily Henry",
  "People We Meet on Vacation Emily Henry",
  "Happy Place Emily Henry",
  "Book Lovers Emily Henry",
  "Great Big Beautiful Life Emily Henry",
  "The Kiss Quotient Helen Hoang",
  "The Love Hypothesis Ali Hazelwood",
  "It Ends with Us Colleen Hoover",
  "Ugly Love Colleen Hoover",
  "Things We Never Got Over Lucy Score",
  "The Spanish Love Deception Elena Arkas",
  "A Court of Thorns and Roses Sarah J Maas",
  "A Court of Mist and Fury Sarah J Maas",
  "Fourth Wing Rebecca Yarros",
  "Iron Flame Rebecca Yarros",
  "Onyx Storm Rebecca Yarros",
  "Quicksilver Callie Hart",
  "Powerless Lauren Roberts",
  "From Blood and Ash Jennifer L Armentrout",
  "Kingdom of the Wicked Kerri Maniscalco",
  "Outlander Diana Gabaldon",
  "The Notebook Nicholas Sparks",
  "Pride and Prejudice Jane Austen",
];

export async function GET(request: NextRequest) {
  // Only allow in development, or with the service role key as a bearer token
  const isDev = process.env.NODE_ENV === "development";
  const authHeader = request.headers.get("authorization");
  const isAuthorized = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

  if (!isDev && !isAuthorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const results: { query: string; found: string | null }[] = [];

  for (const query of SEED_TITLES) {
    try {
      const books = await findBook(query);
      if (books.length > 0) {
        const top = books[0];
        results.push({ query, found: `${top.title} by ${top.author}` });
      } else {
        results.push({ query, found: null });
      }
      // Small delay to be polite to Google Books API
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      results.push({ query, found: null });
    }
  }

  return NextResponse.json({
    seeded: results.filter((r) => r.found).length,
    total: SEED_TITLES.length,
    results,
  });
}
