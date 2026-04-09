/**
 * Test Goodreads "shelved as" Serper query optimization.
 *
 * Tests 3 query formats against 10 known books to find which returns
 * the richest shelf/tag data in Google snippets.
 *
 * Usage: npx tsx scripts/test-goodreads-shelf-query.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const KEY = process.env.SERPER_API_KEY!;

interface TestBook {
  title: string;
  author: string;
  // Known Goodreads shelves for validation
  expectedShelves: string[];
}

const books: TestBook[] = [
  {
    title: "Fourth Wing",
    author: "Rebecca Yarros",
    expectedShelves: ["fantasy", "romance", "enemies-to-lovers", "dragons", "slow-burn"],
  },
  {
    title: "A Court of Thorns and Roses",
    author: "Sarah J. Maas",
    expectedShelves: ["fantasy", "romance", "fae", "enemies-to-lovers"],
  },
  {
    title: "It Ends with Us",
    author: "Colleen Hoover",
    expectedShelves: ["romance", "contemporary", "domestic-violence", "new-adult"],
  },
  {
    title: "Haunting Adeline",
    author: "H.D. Carlton",
    expectedShelves: ["dark-romance", "thriller", "stalker", "spicy"],
  },
  {
    title: "The Love Hypothesis",
    author: "Ali Hazelwood",
    expectedShelves: ["romance", "contemporary", "fake-dating", "stem"],
  },
  {
    title: "Twisted Love",
    author: "Ana Huang",
    expectedShelves: ["romance", "dark-romance", "brother's-best-friend", "new-adult"],
  },
  {
    title: "Ice Planet Barbarians",
    author: "Ruby Dixon",
    expectedShelves: ["romance", "sci-fi-romance", "alien-romance", "spicy"],
  },
  {
    title: "Den of Vipers",
    author: "K.A. Knight",
    expectedShelves: ["dark-romance", "reverse-harem", "mafia", "bully-romance"],
  },
  {
    title: "Beach Read",
    author: "Emily Henry",
    expectedShelves: ["romance", "contemporary", "summer", "enemies-to-lovers"],
  },
  {
    title: "From Blood and Ash",
    author: "Jennifer L. Armentrout",
    expectedShelves: ["fantasy", "romance", "vampires", "slow-burn"],
  },
];

type QueryFormat = {
  name: string;
  build: (b: TestBook) => string;
};

const formats: QueryFormat[] = [
  {
    name: "shelved-as",
    build: (b) => `site:goodreads.com/book/show "${b.title}" "shelved as"`,
  },
  {
    name: "genres",
    build: (b) => `site:goodreads.com "${b.title}" ${b.author} "genres"`,
  },
  {
    name: "shelves-broad",
    build: (b) => `site:goodreads.com "${b.title}" ${b.author} shelves`,
  },
];

function extractShelvesFromSnippet(snippet: string): string[] {
  // Goodreads shelves appear as comma-separated or "·"-separated lists
  // Look for patterns like "shelved as: romance, fantasy, enemies-to-lovers"
  // Or "Genres: Romance, Fantasy Romance, Dark Romance"
  const shelves: string[] = [];

  // Pattern 1: "shelved as" followed by a list
  const shelvedMatch = snippet.match(/shelved\s+as[:\s]+([^.]+)/i);
  if (shelvedMatch) {
    shelves.push(
      ...shelvedMatch[1]
        .split(/[,·•|]/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 1 && s.length < 40)
    );
  }

  // Pattern 2: "Genres" followed by a list
  const genreMatch = snippet.match(/genres?[:\s]+([^.]+)/i);
  if (genreMatch) {
    shelves.push(
      ...genreMatch[1]
        .split(/[,·•|]/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 1 && s.length < 40)
    );
  }

  // Pattern 3: Look for known shelf-like terms in the snippet
  const knownTerms = [
    "romance", "fantasy", "dark-romance", "enemies-to-lovers", "slow-burn",
    "contemporary", "paranormal", "historical", "suspense", "thriller",
    "fake-dating", "reverse-harem", "bully", "mafia", "alien", "vampires",
    "fae", "dragons", "new-adult", "ya", "spicy", "steamy", "smut",
    "friends-to-lovers", "second-chance", "forced-proximity", "grumpy-sunshine",
    "stalker", "sci-fi", "shifter", "werewolf", "billionaire",
  ];
  const lowerSnippet = snippet.toLowerCase();
  for (const term of knownTerms) {
    if (lowerSnippet.includes(term) && !shelves.includes(term)) {
      shelves.push(term);
    }
  }

  return [...new Set(shelves)];
}

async function search(query: string): Promise<{ snippets: string[]; resultCount: number }> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`  Serper ${res.status}: ${body.slice(0, 100)}`);
    return { snippets: [], resultCount: 0 };
  }
  const data = await res.json();
  const organic = data.organic ?? [];
  return {
    snippets: organic.map((r: any) => `${r.title ?? ""} ${r.snippet ?? ""}`),
    resultCount: organic.length,
  };
}

async function main() {
  console.log("=== Goodreads Shelf Query Optimization Test ===\n");
  console.log(`Testing ${formats.length} formats × ${books.length} books = ${formats.length * books.length} queries\n`);

  const results: Record<string, { totalShelves: number; avgShelves: number; bookResults: { title: string; shelves: string[]; snippet: string }[] }> = {};

  for (const format of formats) {
    console.log(`\n--- Format: ${format.name} ---`);
    const bookResults: { title: string; shelves: string[]; snippet: string }[] = [];
    let totalShelves = 0;

    for (const book of books) {
      const query = format.build(book);
      const { snippets } = await search(query);

      const allText = snippets.join(" ");
      const shelves = extractShelvesFromSnippet(allText);
      totalShelves += shelves.length;

      const firstSnippet = snippets[0]?.slice(0, 100) ?? "(no results)";
      bookResults.push({ title: book.title, shelves, snippet: firstSnippet });

      const matchCount = book.expectedShelves.filter((s) =>
        shelves.some((found) => found.includes(s) || s.includes(found))
      ).length;

      console.log(
        `  [${shelves.length} shelves, ${matchCount}/${book.expectedShelves.length} expected] ${book.title}`
      );
      if (shelves.length > 0) {
        console.log(`    Found: ${shelves.slice(0, 8).join(", ")}`);
      }
      console.log(`    Snippet: ${firstSnippet}`);

      await new Promise((r) => setTimeout(r, 400));
    }

    results[format.name] = {
      totalShelves,
      avgShelves: totalShelves / books.length,
      bookResults,
    };
  }

  console.log("\n\n=== SUMMARY ===\n");
  for (const format of formats) {
    const r = results[format.name];
    const booksWithShelves = r.bookResults.filter((b) => b.shelves.length > 0).length;
    console.log(`Format: ${format.name}`);
    console.log(`  Total shelves found:  ${r.totalShelves}`);
    console.log(`  Avg shelves/book:     ${r.avgShelves.toFixed(1)}`);
    console.log(`  Books with any data:  ${booksWithShelves}/${books.length}`);
    console.log();
  }

  console.log("RECOMMENDATION: Use the format with highest avg shelves/book and best coverage.");
}

main().catch(console.error);
