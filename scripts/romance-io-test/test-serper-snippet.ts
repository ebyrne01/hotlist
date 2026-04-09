/**
 * Test Serper snippet quality for romance.io results.
 * The critical question: does Serper return full "tagged as ..." lists
 * or truncate them?
 *
 * Usage: npx tsx scripts/romance-io-test/test-serper-snippet.ts
 */

import "dotenv/config";

const SERPER_API_KEY = process.env.SERPER_API_KEY;

const testBooks = [
  { title: "A Court of Mist and Fury", author: "Sarah J. Maas" },
  { title: "Fourth Wing", author: "Rebecca Yarros" },
  { title: "From Blood and Ash", author: "Jennifer L. Armentrout" },
  { title: "Spark of the Everflame", author: "Penn Cole" },
  { title: "Kingdom of the Wicked", author: "Kerri Maniscalco" },
  { title: "Bonded by Thorns", author: "Elizabeth Helen" },
  { title: "Gild", author: "Raven Kennedy" },
  { title: "The Serpent and the Wings of Night", author: "Carissa Broadbent" },
  { title: "Zodiac Academy", author: "Caroline Peckham" },
  { title: "Psycho Fae", author: "Jasmine Mas" },
];

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  rating?: number;
  ratingCount?: number;
  position?: number;
  sitelinks?: unknown;
  richSnippet?: unknown;
  attributes?: Record<string, string>;
}

const queryFormats = [
  (t: string, a: string) => `site:romance.io "${t}" "${a}" steam rating`,
  (t: string, a: string) => `romance.io rating "${t}" "${a}"`, // current format
  (t: string, a: string) => `site:romance.io "${t}" tagged`,
];

async function testBook(title: string, author: string) {
  console.log(`\n${"#".repeat(80)}`);
  console.log(`BOOK: "${title}" by ${author}`);
  console.log(`${"#".repeat(80)}`);

  for (const buildQuery of queryFormats) {
    const query = buildQuery(title, author);

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 3 }),
    });

    const data = await response.json();

    console.log(`\n${"=".repeat(70)}`);
    console.log(`QUERY: ${query}`);
    console.log(`${"=".repeat(70)}`);

    const results: SerperResult[] = data.organic ?? [];
    const romanceIo = results.filter((r) => r.link.includes("romance.io/"));

    if (romanceIo.length === 0) {
      console.log("NO ROMANCE.IO RESULTS");
      continue;
    }

    for (const result of romanceIo) {
      console.log(`\nURL: ${result.link}`);
      console.log(`TITLE: ${result.title}`);
      console.log(`SNIPPET LENGTH: ${result.snippet?.length || 0} chars`);
      console.log(`SNIPPET: ${result.snippet}`);

      // Check for structured fields
      if (result.rating) console.log(`STRUCTURED RATING: ${result.rating}`);
      if (result.ratingCount) console.log(`STRUCTURED RATING COUNT: ${result.ratingCount}`);
      if (result.attributes) console.log(`ATTRIBUTES: ${JSON.stringify(result.attributes)}`);
      if (result.richSnippet) console.log(`RICH SNIPPET: ${JSON.stringify(result.richSnippet)}`);

      // Check data patterns
      const s = result.snippet || "";
      const hasRating = /Rated\s+[\d.]+\/5/i.test(s) || /[\d.]+\s*·\s*\d+\s*rating/i.test(s);
      const hasSpice = /(?:Steam|Heat|Spice)\s*(?:rating|level)[:\s]*\d/i.test(s);
      const hasTags = /tagged as\s+/i.test(s);
      const hasEllipsis = s.includes("...");

      console.log(`  HAS RATING: ${hasRating}`);
      console.log(`  HAS SPICE: ${hasSpice}`);
      console.log(`  HAS TAGS: ${hasTags}`);
      console.log(`  TRUNCATED (has ...): ${hasEllipsis}`);

      if (hasTags) {
        // Count tags
        const tagMatch = s.match(/tagged as\s+(.+?)(?:\.\s|$)/is);
        if (tagMatch) {
          const tags = tagMatch[1].split(",").map((t) => t.trim()).filter(Boolean);
          console.log(`  TAG COUNT: ${tags.length}`);
          console.log(`  TAGS: ${tags.join(", ")}`);
        }
      }
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  if (!SERPER_API_KEY) {
    console.error("SERPER_API_KEY is not set");
    process.exit(1);
  }

  console.log("Testing Serper romance.io snippet extraction");
  console.log(`Testing ${testBooks.length} books x ${queryFormats.length} query formats`);
  console.log(`Total queries: ${testBooks.length * queryFormats.length}\n`);

  for (const book of testBooks) {
    await testBook(book.title, book.author);
  }

  console.log("\n\nDONE.");
}

main().catch(console.error);
