/**
 * Test: Does fixing video truncation let Haiku read all book covers?
 *
 * Downloads video via RapidAPI, tries ALL available URLs (hdplay, play, wmplay),
 * picks the one that yields the most frames, then sends to Haiku.
 *
 * Usage: set -a && source .env.local && set +a && npx tsx scripts/test-sonnet-vision.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";

const TRANSCRIPT = `Five books so addicting I finished reading them in under 24 hours. My husband had to roll over in bed and pry these books out of my cold dead hands. Be prepared to give up sleep when you pick up one of these books. This is a dark romance so please check the trigger warnings. It will keep you up at night with a flashlight under your blankets making you feel like you're a teenager reading again. He is professionally following her. He professionally follows her home and notices that she has no furniture in her apartment. The next morning she wakes up to knocking on the door and furniture is being delivered for her entire apartment. Does he climb in through her bedroom window a few times without her noticing? Yes okay but god forbid a man has a hobby. This is a completed series so if you have been wanting to start this and you've been waiting for it to be completed well now is your time okay. He is a dragon shifter commander. She is a fey rebel. She enters into fey trials that only three fey can end up winning okay and he tries sabotaging her every chance he gets. This is a true enemies to lovers and you do have spice in book one. In all the books there's spice okay. So if you want a spicy fantasy romance go pick this up. The spiciest book I have ever read in my entire life. I am scarred permanently for the rest of my life because of this okay. It was so good pure filth. No plot to be found but the smut five out of five stars. This book got five out of five stars okay. It is an omega verse book. There was so much going on in this book that they had to clean up liquid from the floors. She is professionally following him. He is in the mafia okay. She doesn't think that he notices that she's following him but he notices. He buys her entire apartment building just so he has access to her apartment where he waits for her in the pitch blackness of her bedroom for her to come home okay. If you have not read this series you need to go read it immediately. Each book is a different dark mafia standalone romance. They all follow different couples. She accidentally summons a demon and the demon deletes her off the earth and now they're both trapped in a like manor together. Tell me a romance that has kept you up reading all night long.`;

const SYSTEM_PROMPT = `You are a book identification assistant for a BookTok video analysis tool. You receive video frames and a transcript from a BookTok/BookStagram video. Your job is to identify every book the creator is recommending, reviewing, or discussing.

YOUR TASK:
1. WATCH: Look at ALL video frames for book covers AND text overlays. Read titles and authors CHARACTER BY CHARACTER from covers and on-screen text.
2. LISTEN: Read the transcript to understand which books the creator is discussing.
3. CROSS-REFERENCE: Match covers with transcript mentions.
4. Return a JSON object with your observations.

CRITICAL RULES:
- Read book covers CHARACTER BY CHARACTER. Do not assume a title based on cover art style or your memory.
- Look for text overlays showing book title and author — these are common in BookTok videos and are often easier to read than the physical cover.
- The creator may hold up a physical book while a text overlay shows the title clearly. Always prefer the text overlay reading.
- Extract sentiment and a creator quote for each book from the transcript.
- Do NOT extract books mentioned only as comparisons or references.
- If a physical cover is mirrored/backwards, look for the text overlay instead.
- NEVER guess a book based on the creator's handle or username.

Return ONLY valid JSON in this format:
{
  "candidates": [
    {
      "title": "exact title as read from cover or text overlay",
      "author": "author name",
      "source": "cover" | "transcript" | "both",
      "confidence": "high" | "medium" | "low",
      "sentiment": "loved" | "liked" | "mixed" | "disliked" | "neutral",
      "quote": "direct quote from creator"
    }
  ],
  "videoSummary": "one sentence describing what this video is about"
}`;

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required");

  const { extractFrames } = await import("../lib/video/frame-extractor");

  const tiktokUrl = "https://www.tiktok.com/@probablyoffreading/video/7606118773036207374";
  const rapidApiKey = process.env.RAPIDAPI_KEY;
  const rapidApiHost = process.env.RAPIDAPI_VIDEO_HOST || process.env.RAPIDAPI_TIKTOK_HOST;
  if (!rapidApiKey || !rapidApiHost) throw new Error("RAPIDAPI_KEY and RAPIDAPI_VIDEO_HOST required");

  console.log(`Downloading video via ${rapidApiHost}...`);

  // Try multiple endpoint patterns
  const endpoints = [
    `https://${rapidApiHost}/vid/index?url=${encodeURIComponent(tiktokUrl)}`,
    `https://${rapidApiHost}/getVideo?url=${encodeURIComponent(tiktokUrl)}`,
    `https://${rapidApiHost}/?url=${encodeURIComponent(tiktokUrl)}`,
  ];

  // Collect ALL available video URLs from API response
  const allVideoUrls: { label: string; url: string }[] = [];
  let reportedDuration: number | null = null;

  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint, {
        headers: {
          "x-rapidapi-key": rapidApiKey,
          "x-rapidapi-host": rapidApiHost,
        },
      });
      if (!resp.ok) {
        console.log(`  ${endpoint.split("?")[0]} → ${resp.status}`);
        continue;
      }
      const data = await resp.json() as any;
      console.log(`  ${endpoint.split("?")[0]} → OK, top-level keys: ${Object.keys(data).join(", ")}`);
      const d = data?.data || data;
      if (data?.data) console.log(`  data.data keys: ${Object.keys(data.data).join(", ")}`);

      if (d?.duration) reportedDuration = Math.round(Number(d.duration));
      if (d?.hdplay) allVideoUrls.push({ label: "hdplay (HD no-watermark)", url: d.hdplay });
      if (d?.play && d.play !== d?.hdplay) allVideoUrls.push({ label: "play (SD no-watermark)", url: d.play });
      if (d?.wmplay) allVideoUrls.push({ label: "wmplay (watermarked full-length)", url: d.wmplay });
      // Also check for video/video_url fields
      if (d?.video_url) allVideoUrls.push({ label: "video_url", url: d.video_url });
      if (d?.videoUrl) allVideoUrls.push({ label: "videoUrl", url: d.videoUrl });
      if (Array.isArray(d?.video)) {
        d.video.forEach((v: string, i: number) => allVideoUrls.push({ label: `video[${i}]`, url: v }));
      } else if (typeof d?.video === "string") {
        allVideoUrls.push({ label: "video", url: d.video });
      }
      // OriginalWatermarkedVideo — full-length, watermarked
      if (Array.isArray(data?.OriginalWatermarkedVideo)) {
        data.OriginalWatermarkedVideo.forEach((v: string, i: number) =>
          allVideoUrls.push({ label: `OriginalWatermarkedVideo[${i}]`, url: v })
        );
      }

      if (allVideoUrls.length > 0) {
        console.log(`API reports duration: ${reportedDuration}s`);
        console.log(`Found ${allVideoUrls.length} video URLs:`);
        allVideoUrls.forEach((v) => console.log(`  - ${v.label}`));
        break;
      }
      console.log(`  No video URLs found in response`);
    } catch (e) {
      console.log(`  ${endpoint.split("?")[0]} → error: ${e}`);
    }
  }

  if (allVideoUrls.length === 0) {
    console.error("No video URLs found");
    return;
  }

  // Use first URL — the duration probe fix in extractFrames should now cover the full video
  const { label: bestLabel, url: bestUrl } = allVideoUrls[0];
  console.log(`\nExtracting frames from ${bestLabel} (duration probe will auto-detect length)...`);
  const bestFrames = await extractFrames(bestUrl, reportedDuration);

  if (bestFrames.length === 0) {
    console.error("No frames extracted from any URL");
    return;
  }

  // Save frames for inspection
  const outDir = path.join(__dirname, "test-frames");
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < bestFrames.length; i++) {
    fs.writeFileSync(path.join(outDir, `frame-${String(i).padStart(3, "0")}.jpg`), bestFrames[i]);
  }
  console.log(`Saved ${bestFrames.length} frames to ${outDir}`);

  // Build content blocks
  const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];
  for (const frame of bestFrames) {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: frame.toString("base64"),
      },
    });
  }

  contentBlocks.push({
    type: "text",
    text: `These are ${bestFrames.length} sequential frames from a BookTok video. Below is the audio transcript.

TRANSCRIPT:
${TRANSCRIPT}

Identify every book the creator is recommending or discussing. Return your observations as JSON.`,
  });

  console.log(`\nSending ${bestFrames.length} frames to Haiku...\n`);
  const client = new Anthropic({ apiKey });
  const t0 = Date.now();

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: contentBlocks }],
  });

  const ms = Date.now() - t0;
  console.log(`Haiku responded in ${ms}ms`);
  console.log(`Usage: ${JSON.stringify(response.usage)}`);

  const textBlock = response.content.find((b) => b.type === "text");
  if (textBlock && textBlock.type === "text") {
    console.log("\n--- HAIKU RESULTS ---\n");
    console.log(textBlock.text);
  }

  console.log("\n--- EXPECTED ---");
  console.log("1. Stalked by Seduction and Shadows - Maggie Sunseri");
  console.log("2. Empire of Flame and Thorns - Marion Blackwood");
  console.log("3. Heat Clinic - Alexis Osborne");
  console.log("4. Insidious Obsession - Kai Carrington-Russell");
  console.log("5. Eldrith Manor - Leigh Rivers & Avina St. Graves");
}

main().catch(console.error);
