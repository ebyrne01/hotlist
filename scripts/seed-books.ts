/**
 * Seed script: searches for popular romance/romantasy titles via the app's
 * search + enrichment pipeline so the homepage has great data from day one.
 *
 * Usage: npx tsx scripts/seed-books.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { searchBooks } from "../lib/search";
import { findBook } from "../lib/books";

const SEED_TITLES = [
  // Contemporary romance
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
  // Romantasy
  "A Court of Thorns and Roses Sarah J Maas",
  "A Court of Mist and Fury Sarah J Maas",
  "Throne of Glass Sarah J Maas",
  "Fourth Wing Rebecca Yarros",
  "Iron Flame Rebecca Yarros",
  "Onyx Storm Rebecca Yarros",
  "Quicksilver Callie Hart",
  "Powerless Lauren Roberts",
  "From Blood and Ash Jennifer L Armentrout",
  "Kingdom of the Wicked Kerri Maniscalco",
  "House of Flame and Shadow Sarah J Maas",
  "Zodiac Academy Caroline Peckham",
  // Classic / beloved
  "Outlander Diana Gabaldon",
  "The Notebook Nicholas Sparks",
  "Pride and Prejudice Jane Austen",
];

async function seed() {
  console.log(`Seeding ${SEED_TITLES.length} romance/romantasy titles...\n`);

  for (const query of SEED_TITLES) {
    try {
      console.log(`Searching: "${query}"`);
      const results = await searchBooks(query);
      if (results.length > 0) {
        console.log(`  -> Found: "${results[0].title}" by ${results[0].author}`);
        // Trigger enrichment by looking up the book detail
        await findBook(results[0].title + " " + results[0].author);
      } else {
        console.log(`  -> No results`);
      }
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.warn(`  -> Error: ${err}`);
    }
  }

  console.log("\nDone! Enrichment is running in the background.");
  console.log("Ratings will appear on the homepage once scraping completes.");
}

seed();
