/**
 * Step 0: Test the Goodreads Scraper actor to understand its output schema.
 * Run: npx tsx scripts/goodreads-enrichment/test-actor.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const ACTOR_ID = "epctex~goodreads-scraper";

async function main() {
  console.log("=== Testing Goodreads Scraper Actor ===\n");

  // Test with a known Goodreads URL (direct page scrape)
  const input = {
    startUrls: [
      "https://www.goodreads.com/book/show/50659467-a-court-of-thorns-and-roses",
    ],
    includeReviews: false,
    maxItems: 1,
    proxy: {
      useApifyProxy: true,
    },
  };

  console.log("Input:", JSON.stringify(input, null, 2));

  const startUrl = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`;
  const res = await fetch(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    console.error("Start failed:", res.status, await res.text());
    return;
  }

  const run = await res.json();
  const runId = run.data.id;
  const datasetId = run.data.defaultDatasetId;
  console.log("Run started:", runId);

  // Poll for completion
  let status = "RUNNING";
  while (["RUNNING", "READY"].includes(status)) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`;
    const statusRes = await fetch(statusUrl);
    const statusData = await statusRes.json();
    status = statusData.data.status;
    const cost = Math.round((statusData.data.usageTotalUsd ?? 0) * 10000) / 10000;
    console.log("  Status:", status, "($" + cost + ")");
  }

  if (status !== "SUCCEEDED") {
    console.error("Run failed:", status);
    return;
  }

  // Fetch results
  const dataUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`;
  const dataRes = await fetch(dataUrl);
  const items = await dataRes.json();

  console.log("\nGot " + items.length + " result(s)\n");

  if (items.length > 0) {
    const item = items[0];

    console.log("=== FIELD NAMES & TYPES ===");
    for (const [key, value] of Object.entries(item)) {
      const type = Array.isArray(value)
        ? "array[" + (value as unknown[]).length + "]"
        : typeof value;
      let sample: string;
      if (Array.isArray(value)) {
        sample = JSON.stringify((value as unknown[]).slice(0, 3));
      } else if (typeof value === "string" && (value as string).length > 150) {
        sample = '"' + (value as string).slice(0, 150) + '..."';
      } else {
        sample = JSON.stringify(value);
      }
      console.log("  " + key + ": " + type + " = " + sample);
    }

    console.log("\n=== RAW JSON ===");
    console.log(JSON.stringify(items[0], null, 2));
  }
}

main().catch(console.error);
