/**
 * BOOK AGENT — Single Sonnet call with tool use for BookTok extraction.
 *
 * Replaces the old fragmented pipeline (Haiku extraction → Sonnet correction →
 * Sonnet reconciliation → fuzzy resolver → series swapper) with ONE Sonnet call
 * that can SEE the video frames, READ the transcript, and SEARCH Goodreads
 * to verify its answers in real time.
 *
 * This eliminates the compounding errors of the old pipeline:
 * - No more reconciler hallucinating wrong series entries
 * - No more ILIKE matching "Mallory" to "Mallory, Mallory: the revenge..."
 * - No more Book 6 → Book 1 swapping that sometimes finds the wrong book
 *
 * Cost: ~$0.05-0.10 per call (vision + tool use, but only ONE call instead of 4).
 */

import Anthropic from "@anthropic-ai/sdk";
import { getBookDetail } from "@/lib/books";
import { isJunkTitle } from "@/lib/books/romance-filter";
import { getAdminClient } from "@/lib/supabase/admin";
import { searchBooksForAgent } from "./agent-search";
import { searchGoogleBooks } from "@/lib/books/google-books";
import { saveProvisionalBook } from "@/lib/books/cache";
import type { ResolvedBook, ResolvedBookMatched, ResolvedBookUnmatched } from "./book-resolver";

/** Collects debug log entries and flushes to Supabase at the end */
class AgentDebugLog {
  private entries: string[] = [];
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  log(msg: string) {
    this.entries.push(`${new Date().toISOString()} ${msg}`);
    console.log(`[book-agent] ${msg}`);
  }

  async flush() {
    try {
      const supabase = getAdminClient();
      await supabase.from("agent_debug_logs").insert({
        url: this.url,
        log_entries: this.entries,
      });
    } catch (e) {
      console.error("[book-agent] Failed to flush debug log:", e);
    }
  }
}

const SONNET_MODEL = "claude-sonnet-4-6";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/** Time budget for the Phase 2 Sonnet agent loop (ms). */
const AGENT_TIME_BUDGET_MS = 180_000; // 3 min — Phase 1 takes ~5-10s, leaves headroom in 4.5-min pipeline

// ─── Two-Phase Types ───────────────────────────────────────────────────────────

/** A book candidate observed by Haiku in Phase 1 */
export interface HaikuCandidate {
  title: string;
  author: string;
  source: "cover" | "transcript" | "both";
  confidence: "high" | "medium" | "low";
  sentiment: "loved" | "liked" | "mixed" | "disliked" | "neutral";
  quote: string;
  seriesRecommendation?: boolean;
  notes?: string;
}

/** Phase 1 observation result from Haiku */
export interface ObservationResult {
  candidates: HaikuCandidate[];
  isSeriesVideo: boolean;
  videoSummary: string;
}

// ─── Phase 1: Haiku Observation ────────────────────────────────────────────────

const PHASE1_SYSTEM_PROMPT = `You are a book identification assistant for a BookTok video analysis tool. You receive video frames and a transcript from a BookTok/BookStagram video. Your job is to identify every book the creator is recommending, reviewing, or discussing.

YOUR TASK:
1. WATCH: Look at ALL video frames for book covers. Read titles and authors CHARACTER BY CHARACTER from covers.
2. LISTEN: Read the transcript to understand which books the creator is discussing.
3. CROSS-REFERENCE: Match covers with transcript mentions. The creator may show Book 3 while recommending Book 1.
4. Return a JSON object with your observations.

CRITICAL RULES:
- Read book covers CHARACTER BY CHARACTER. Do not assume a title based on cover art style or your memory.
- Extract sentiment and a creator quote for each book from the transcript.
- Do NOT extract books mentioned only as comparisons or references. Only extract books the creator is ACTUALLY recommending, reviewing, or showcasing.
- NEGATIVE SENTIMENT: If the creator explicitly dismisses or criticizes books, mark those with sentiment "disliked" and a quote capturing the criticism. Still include them.
- Do NOT extract planners, journals, non-book products.
- If a cover is partially obscured, include your best reading with confidence "low".
- NEVER guess a book based on the creator's handle or username.

COMPARISON FILTERING — these are NOT recommendations:
- "if you liked X" → do NOT extract X (it's a comparison, not a rec)
- "it gives X vibes" → do NOT extract X
- "similar to X" → do NOT extract X
- "like ACOTAR but darker" → do NOT extract ACOTAR
- Only extract a book if the creator is directly recommending, reviewing, or showcasing it.

NEW RELEASES PATTERN — pay special attention:
- In "new releases" or "books coming out this month" videos, the creator often introduces each new book by comparing it to an older, well-known book: "if you loved [OLD BOOK], you'll love [NEW RELEASE]"
- Extract the NEW RELEASE, NOT the old comparison book.
- The new release is usually the one with a cover shown, the one being described in detail, or the one the creator says is "coming out" / "releasing" / "dropping."
- If the creator shows Cover A while saying "if you loved [Cover A's title], check out [Book B]", extract Book B (even if you can't read its cover), NOT Cover A.

Example: "If you loved Fourth Wing, you NEED to read this trilogy" — do NOT extract Fourth Wing. Only extract "this trilogy."
Example: "This one has Powerless Trilogy vibes" — do NOT extract Powerless Trilogy.
Example: "If you loved On Wings of Blood, The Wings that Bind releases March 15th" — extract The Wings that Bind, NOT On Wings of Blood.
Example: "Heart of Mischief is the sequel to Soul of Shadow" — extract Heart of Mischief ONLY (the new release), NOT Soul of Shadow (the predecessor).
Example: "Starside, the next book in the Lightlark series" — extract Starside ONLY, NOT Lightlark.
Example: "No, no, no, this one was terrible" → extract with sentiment "disliked", quote "no, no, no, this one was terrible"

SERIES PREDECESSOR FILTERING — do NOT extract these:
- When the creator says "Book 2 is coming out" and mentions Book 1 as context, ONLY extract Book 2.
- "Soul of Shadow was the first book, Heart of Mischief releases next week" → extract Heart of Mischief ONLY.
- "This is Book 3 in the series, starting with Anathema" → extract Book 3 ONLY, not Anathema.
- "Starside is the next book in the Lightlark series" → extract Starside ONLY, not Lightlark.
- If a creator mentions an earlier book ONLY to provide context for the new release, that earlier book is NOT a recommendation.
- ONLY extract a series predecessor if the creator explicitly recommends reading it on its own merits (e.g., "you need to read Book 1 before this comes out").

SERIES HANDLING:
- Only mark isSeriesVideo: true when the creator's EXPLICIT THEME is recommending complete series/trilogies to binge (e.g., "completed series you need to read", "trilogies I devoured"). Do NOT set isSeriesVideo: true just because the video contains books that happen to be part of a series.
- When a creator recommends a series by name ("you HAVE to read [series name]"), mark that candidate's seriesRecommendation: true.
- A video like "books everyone needs to read" or "new releases this month" that features series books is NOT a series video — it's a general recommendation video.
- IMPORTANT: When you can read INDIVIDUAL book covers from a series on screen, list each book as its own candidate (e.g., "Fourth Wing", "Iron Flame", "Onyx Storm" as 3 separate entries) rather than a single "The Empyrean Series" entry. Set seriesRecommendation: true on each one. Only use the series name as the candidate title if you cannot read individual titles.
- When the transcript names individual books in a series, list each one as a separate candidate.

KNOWN WHISPER ERRORS — the transcript may contain these garbled versions:
- "Sara J. Mass" or "Sarah J. Moss" → Sarah J. Maas
- "Rebecca Yarrows" or "Rebecca Yarrose" or "Rebecca Yaros" → Rebecca Yarros
- "Anna Wong" or "Ana Wong" → Ana Huang
- "HD Carlton" → H.D. Carlton
- "Kayleen Hoover" or "Colleen Hover" → Colleen Hoover
- "Kristen Hanna" → Kristin Hannah
- "McKaylee Smeltzer" or "Micalee Smeltzer" → Micalea Smeltzer
- "Rachel Gillick" or "Rachel Gillik" → Rachel Gillig
- "Kristen Cicirelli" or "Kristen Chiccarelli" → Kristen Ciccarelli
- "Cynlyn Yu" or "Sinlin Yu" → SenLinYu
- "Debney Perry" → Devney Perry
- "Alex Astor" → Alex Aster
- "On a Storm" or "Onyx Store" → Onyx Storm
- "Iron Frame" → Iron Flame
- "The Night in the Moth" → The Knight and the Moth
- "Ashes of Thesmar" or "Thesmar" → Thezmarr

COMMON BOOKTOK ABBREVIATIONS:
- "ACOTAR" → "A Court of Thorns and Roses" by Sarah J. Maas
- "ACOSF" → "A Court of Silver Flames" by Sarah J. Maas
- "FBAA" → "From Blood and Ash" by Jennifer L. Armentrout
- "TOG" → "Throne of Glass" by Sarah J. Maas
- "CC" → "House of Earth and Blood" by Sarah J. Maas (Crescent City)
- "TLH" → "The Love Hypothesis" by Ali Hazelwood

PHOTO/CAROUSEL POSTS:
- Some posts are photo carousels. Each image is a separate slide.
- Text overlays often list book titles and authors. Read these carefully.
- If the transcript is just background music lyrics, ignore it entirely and rely only on the images.

VISUAL-ONLY VIDEOS:
- If the transcript is empty or just music, rely entirely on what you can read from book covers and text overlays.
- Do NOT try to identify books from cover art style alone — you need readable text.

Return ONLY valid JSON in this format:
{
  "candidates": [
    {
      "title": "exact title as read from cover or heard in transcript",
      "author": "author name (corrected if Whisper error)",
      "source": "cover" | "transcript" | "both",
      "confidence": "high" | "medium" | "low",
      "sentiment": "loved" | "liked" | "mixed" | "disliked" | "neutral",
      "quote": "direct quote or close paraphrase from creator",
      "seriesRecommendation": true/false,
      "notes": "optional — any context like 'showed Book 3 but recommending series from start'"
    }
  ],
  "isSeriesVideo": true/false,
  "videoSummary": "one sentence describing what this video is about"
}`;

/**
 * Phase 1: Observe with Haiku.
 *
 * Sends ALL frames + full transcript to Haiku in a single turn.
 * No tools, no loop — just vision + text understanding.
 * Returns structured candidate list for Phase 2 verification.
 *
 * Cost: ~$0.003-0.006 per call (Haiku vision is 10-20x cheaper than Sonnet).
 */
async function observeWithHaiku(
  frames: (string | Buffer)[],
  transcript: string,
  creatorHandle: string | undefined,
  isSeriesMode: boolean,
  dbg: AgentDebugLog
): Promise<ObservationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    dbg.log("Phase 1: Missing ANTHROPIC_API_KEY");
    return { candidates: [], isSeriesVideo: false, videoSummary: "" };
  }

  const client = new Anthropic({ apiKey });
  const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];

  // Add ALL frames — Haiku vision is cheap, send everything
  for (const img of frames) {
    if (typeof img === "string") {
      contentBlocks.push({
        type: "image",
        source: { type: "url", url: img },
      });
    } else if (Buffer.isBuffer(img)) {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: img.toString("base64"),
        },
      });
    }
  }

  // Add transcript — NO truncation, send full text
  const handleNote = creatorHandle ? `Video by ${creatorHandle}.\n\n` : "";
  const isCarousel = transcript.includes("photo/carousel post");
  const mediaDescription = isCarousel
    ? `These are ${frames.length} images from a BookTok photo/carousel post (slideshow). Each image is a separate slide. Look at ALL slides for book covers, titles, or text overlays.`
    : `These are ${frames.length} sequential frames from a BookTok video. Below is the audio transcript.`;

  const seriesNote = isSeriesMode
    ? "\n\nNOTE: This video appears to be about series/trilogy recommendations. Mark all series with seriesRecommendation: true."
    : "";

  contentBlocks.push({
    type: "text",
    text: `${handleNote}${mediaDescription}

TRANSCRIPT:
${transcript}
${seriesNote}

Identify every book the creator is recommending or discussing. Return your observations as JSON.`,
  });

  dbg.log(`Phase 1: Sending ${frames.length} frames + ${transcript.length} chars to Haiku...`);
  const t0 = Date.now();

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: PHASE1_SYSTEM_PROMPT,
      messages: [{ role: "user", content: contentBlocks }],
    });

    const ms = Date.now() - t0;
    dbg.log(`Phase 1: Haiku responded in ${ms}ms, usage=${JSON.stringify(response.usage)}`);

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      dbg.log("Phase 1: No text in Haiku response");
      return { candidates: [], isSeriesVideo: false, videoSummary: "" };
    }

    // Parse JSON — handle markdown code blocks
    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonStr);
    const candidates: HaikuCandidate[] = (parsed.candidates ?? [])
      .filter((c: Record<string, unknown>) => c.title && typeof c.title === "string")
      .map((c: Record<string, unknown>) => ({
        title: c.title as string,
        author: (c.author as string) || "",
        source: (c.source as HaikuCandidate["source"]) || "transcript",
        confidence: (c.confidence as HaikuCandidate["confidence"]) || "medium",
        sentiment: (c.sentiment as HaikuCandidate["sentiment"]) || "neutral",
        quote: (c.quote as string) || "",
        seriesRecommendation: c.seriesRecommendation === true,
        notes: (c.notes as string) || undefined,
      }));

    const result: ObservationResult = {
      candidates,
      isSeriesVideo: parsed.isSeriesVideo === true || isSeriesMode,
      videoSummary: (parsed.videoSummary as string) || "",
    };

    dbg.log(`Phase 1: ${candidates.length} candidates found. Series video: ${result.isSeriesVideo}. Summary: ${result.videoSummary}`);
    for (const c of candidates) {
      dbg.log(`  → "${c.title}" by ${c.author} [${c.source}, ${c.confidence}] sentiment=${c.sentiment}${c.seriesRecommendation ? " (SERIES)" : ""}`);
    }

    return result;
  } catch (err) {
    dbg.log(`Phase 1 ERROR: ${String(err)}`);
    return { candidates: [], isSeriesVideo: false, videoSummary: "" };
  }
}

// ─── Phase 2: Sonnet Verification ──────────────────────────────────────────────

const PHASE2_SYSTEM_PROMPT = `You are a book verification agent for a BookTok video analysis tool. You receive a list of book candidates that were observed from video frames and transcript by a preliminary scan. Your job is to verify each candidate against Goodreads and submit the final canonical list.

YOUR PROCESS:
1. REVIEW the candidate list. Each candidate has a title, author, source (cover/transcript/both), confidence, and sentiment.
2. SEARCH: Use search_goodreads to find each candidate on Goodreads. Call search_goodreads for ALL candidates in a SINGLE turn to save time.
3. VERIFY: Check that search results match the candidates. The preliminary scan may have misread a cover — if a search returns 0 results, try ONE variation (title alone, or alternate spelling).
4. CONFIRM: Use confirm_book to get series info for books where you found a Goodreads ID.
5. SUBMIT: Call submit_books with your final verified list.

CRITICAL RULES:
- ALWAYS use search_goodreads to verify. Never guess Goodreads IDs.
- BATCH tool calls: search ALL candidates in one turn, then confirm ALL in the next.
- The preliminary scan already filtered out comparisons and non-recommendations. Trust the candidate list but verify identities.
- Preserve the sentiment and quote from each candidate in your submission.
- ONLY submit books from the candidate list. Do NOT add books that were not in the candidates (no series companions, no sequels, no prequels).
- NEVER swap a candidate for a different book in its series. If "Cinder Vale" is the candidate and it's Book 3, submit Book 3. Do NOT search for or submit Book 1 ("Never Keep"). If "Heart of Mischief" is the candidate and it's Book 2, submit Book 2. Do NOT submit Book 1 ("Soul of Shadow").
- Do NOT search for "book one" or "book 1" of any series. You are verifying candidates, not finding starting points.
- If you cannot find a Goodreads ID after 2 search attempts, submit with null goodreads_id. Do not keep retrying.

SEARCH STRATEGY when a search returns 0 results:
The preliminary scan often misreads book covers — titles and author names may be garbled. The search system tries fuzzy matching and query variations automatically, but if you get 0 results, try these strategies IN ORDER:
1. Author name alone (e.g., "J.M. Grosvalet") — author names are often partially correct even when titles are mangled.
2. Title alone without author — removes noise from garbled author names.
3. The most distinctive word from the title — short common words fail, but distinctive words like "Quicksilver" or "Medusa" often work.
4. Fix obvious OCR errors: missing spaces ("BloodSo" → "Blood So"), swapped letters, truncated words. Think about what the REAL title might be if the cover was partially obscured or blurry.
- Do NOT add descriptive keywords like "dragon shifter", "fantasy romance" to searches.
- Do NOT search for "book one", "book 1", or "series name book one" — you must find the CANDIDATE book, not Book 1.
- Maximum 3 search attempts per candidate. After that, submit with null goodreads_id and include the original title/author from the scan as-is.

KNOWN WHISPER ERRORS — the preliminary scan should have corrected these, but double-check:
- "Sara J. Mass" → Sarah J. Maas
- "Rebecca Yarrows" → Rebecca Yarros
- "Anna Wong" → Ana Huang
- "HD Carlton" → H.D. Carlton
- "Ashes of Thesmar" → Thezmarr

Call submit_books exactly ONCE with ALL verified books when you are done.`;

/**
 * Phase 2: Verify with Sonnet.
 *
 * Takes the candidate list from Phase 1 (text only, NO images) and
 * uses the agentic tool loop to search/confirm each book on Goodreads.
 *
 * Cost: ~$0.01-0.02 per call (text-only Sonnet, no vision tokens).
 */
async function verifyWithSonnet(
  observation: ObservationResult,
  input: BookAgentInput,
  dbg: AgentDebugLog,
  capturedToolCalls: AgentToolCall[]
): Promise<SubmittedBook[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const client = new Anthropic({ apiKey });

  // Build user message from candidate list — text only, no images
  const candidateLines = observation.candidates.map((c, i) => {
    const parts = [
      `${i + 1}. "${c.title}" by ${c.author}`,
      `   Source: ${c.source} | Confidence: ${c.confidence} | Sentiment: ${c.sentiment}`,
    ];
    if (c.quote) parts.push(`   Quote: "${c.quote}"`);
    if (c.seriesRecommendation) parts.push(`   → Part of a series (submit this exact book, NOT Book 1)`);
    if (c.notes) parts.push(`   Notes: ${c.notes}`);
    return parts.join("\n");
  }).join("\n\n");

  const seriesNote = "";

  const userMessage = `Here are ${observation.candidates.length} book candidates observed from a BookTok video:

VIDEO CONTEXT: ${observation.videoSummary}

CANDIDATES:
${candidateLines}
${seriesNote}

Verify each candidate on Goodreads using search_goodreads, then call submit_books with the final verified list. IMPORTANT: Batch all search_goodreads calls into a single turn.`;

  dbg.log(`Phase 2: Sending ${observation.candidates.length} candidates to Sonnet for verification...`);

  // Agentic loop — reuses existing tool execution logic
  let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userMessage }];
  let submittedBooks: SubmittedBook[] | null = null;
  const maxTurns = 7;
  let turn = 0;
  let rateLimitRetries = 0;
  const MAX_RATE_LIMIT_RETRIES = 2;
  const agentStart = Date.now();

  const confirmedBooks = new Map<string, { goodreads_id: string; title: string; author: string }>();

  while (turn < maxTurns && !submittedBooks) {
    turn++;
    const turnStart = Date.now();
    const elapsed = turnStart - agentStart;

    if (elapsed > AGENT_TIME_BUDGET_MS && turn > 2) {
      dbg.log(`Phase 2: Time budget exceeded (${elapsed}ms) at turn ${turn}. Force-stopping and using confirmed books.`);
      break; // Hard stop — fall through to confirmed books fallback
    }

    dbg.log(`Phase 2 Turn ${turn}: sending request...`);

    let response: Anthropic.Messages.Message;
    try {
      response = await client.messages.create({
        model: SONNET_MODEL,
        max_tokens: 8192,
        temperature: 0,
        system: PHASE2_SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
    } catch (apiErr) {
      const errStr = String(apiErr);
      if ((errStr.includes("429") || errStr.includes("rate_limit") || errStr.includes("Rate limit")) && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
        rateLimitRetries++;
        dbg.log(`Phase 2: RATE LIMITED on turn ${turn}, waiting 60s (${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})...`);
        await new Promise((r) => setTimeout(r, 60_000));
        turn--;
        continue;
      }
      dbg.log(`Phase 2 ERROR: Anthropic API error on turn ${turn}: ${errStr}`);
      break;
    }

    const apiMs = Date.now() - turnStart;
    dbg.log(`Phase 2 Turn ${turn}: stop_reason=${response.stop_reason}, api_ms=${apiMs}, usage=${JSON.stringify(response.usage)}`);

    if (response.stop_reason === "end_turn") {
      const textBlocks = response.content.filter(b => b.type === "text");
      if (textBlocks.length > 0) {
        dbg.log(`Phase 2: Model stopped with text: ${(textBlocks[0] as Anthropic.Messages.TextBlock).text.slice(0, 300)}`);
      }
      break;
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );
    if (toolUseBlocks.length === 0) break;

    dbg.log(`Phase 2 Turn ${turn}: ${toolUseBlocks.length} tool calls: ${toolUseBlocks.map(b => b.name).join(", ")}`);

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (toolUse): Promise<Anthropic.Messages.ToolResultBlockParam> => {
        const toolInput = toolUse.input as Record<string, unknown>;
        try {
          if (toolUse.name === "search_goodreads") {
            const query = toolInput.query as string;
            dbg.log(`search_goodreads("${query}")`);
            const results = await searchBooksForAgent(query);
            const simplified = results.map((r) => ({
              goodreads_id: r.goodreads_id,
              title: r.title,
              author: r.author,
              rating: r.rating,
              rating_count: r.rating_count,
              series_name: r.series_name,
              series_position: r.series_position,
              source: r.source,
            }));
            dbg.log(`search_goodreads("${query}") => ${simplified.length} results: ${simplified.map(s => `${s.title} (${s.goodreads_id})`).join(", ")}`);
            capturedToolCalls.push({ tool: "search_goodreads", input: { query }, output: simplified, turn });
            return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(simplified) };
          } else if (toolUse.name === "confirm_book") {
            const goodreadsId = toolInput.goodreads_id as string;
            dbg.log(`confirm_book(${goodreadsId})`);
            const detail = await getBookDetail(goodreadsId);
            if (detail) {
              const confirmOutput = {
                goodreads_id: detail.goodreadsId,
                title: detail.title,
                author: detail.author,
                series_name: detail.seriesName,
                series_position: detail.seriesPosition,
                genres: detail.genres?.slice(0, 5),
                rating: detail.ratings?.[0]?.rating,
              };
              dbg.log(`confirm_book(${goodreadsId}) => "${detail.title}" by ${detail.author} (series: ${detail.seriesName} #${detail.seriesPosition})`);
              confirmedBooks.set(goodreadsId, { goodreads_id: goodreadsId, title: detail.title, author: detail.author });
              capturedToolCalls.push({ tool: "confirm_book", input: { goodreads_id: goodreadsId }, output: confirmOutput, turn });
              return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(confirmOutput) };
            } else {
              dbg.log(`confirm_book(${goodreadsId}) => NOT FOUND`);
              capturedToolCalls.push({ tool: "confirm_book", input: { goodreads_id: goodreadsId }, output: { error: "Book not found" }, turn });
              return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify({ error: "Book not found" }) };
            }
          } else if (toolUse.name === "submit_books") {
            const books = (toolInput.books as SubmittedBook[]) ?? [];
            submittedBooks = books;
            dbg.log(`submit_books(${books.length}): ${JSON.stringify(books.map((b) => ({ title: b.title, author: b.author, gid: b.goodreads_id })))}`);
            return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify({ status: "accepted", count: books.length }) };
          } else {
            return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` }) };
          }
        } catch (toolErr) {
          dbg.log(`Phase 2 ERROR: Tool ${toolUse.name} failed: ${String(toolErr)}`);
          return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify({ error: `Tool failed: ${String(toolErr)}` }), is_error: true };
        }
      })
    );

    messages = [
      ...messages,
      { role: "assistant", content: response.content },
      { role: "user", content: toolResults },
    ];
  }

  dbg.log(`Phase 2 complete: ${turn} turns, ${Date.now() - agentStart}ms`);

  // Fallback: use confirmed books if agent never submitted
  if (!submittedBooks || (submittedBooks as SubmittedBook[]).length === 0) {
    if (confirmedBooks.size > 0) {
      dbg.log(`Phase 2: No submit_books call, using ${confirmedBooks.size} confirmed books as fallback`);
      // Match confirmed books back to Haiku candidates for sentiment/quotes
      return Array.from(confirmedBooks.values()).map(b => {
        const candidate = observation.candidates.find(c =>
          c.title.toLowerCase().includes(b.title.toLowerCase().split(":")[0]) ||
          b.title.toLowerCase().includes(c.title.toLowerCase().split(":")[0])
        );
        return {
          goodreads_id: b.goodreads_id,
          title: b.title,
          author: b.author,
          sentiment: candidate?.sentiment ?? "neutral",
          creator_quote: candidate?.quote ?? "",
        };
      });
    }
    return [];
  }

  return submittedBooks as SubmittedBook[];
}

// ─── Tools (shared by Phase 2) ─────────────────────────────────────────────────

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "search_goodreads",
    description:
      "Search for a book by title, author, or series name. Checks our local database first (instant), then Google Books (fast), then Goodreads (slow). Returns up to 5 results with title, author, Goodreads ID, series info, and rating. Results from local_db already include series_name and series_position — you may not need to call confirm_book for those.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query — e.g. 'Dragon Actually G.A. Aiken' or 'Brides of Karadok Alice Coldbreath'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "confirm_book",
    description:
      "Confirm a book identification by its Goodreads ID. Returns full book detail including series name, series position, genres, and description. Use this after search_goodreads to verify the identity of the book. Do NOT use this to find or swap for a different book in the same series.",
    input_schema: {
      type: "object" as const,
      properties: {
        goodreads_id: {
          type: "string",
          description: "The Goodreads book ID to look up",
        },
      },
      required: ["goodreads_id"],
    },
  },
  {
    name: "submit_books",
    description:
      "Submit the final list of identified books. Call this ONCE when you have identified and verified all books from the video. Each book should have a goodreads_id if you found it on Goodreads, or raw title/author if you couldn't find it.",
    input_schema: {
      type: "object" as const,
      properties: {
        books: {
          type: "array",
          items: {
            type: "object",
            properties: {
              goodreads_id: {
                type: "string",
                description: "Goodreads ID if found (null if unresolved)",
              },
              title: {
                type: "string",
                description: "Book title (exact from Goodreads if resolved, best guess if not)",
              },
              author: {
                type: "string",
                description: "Author name",
              },
              sentiment: {
                type: "string",
                enum: ["loved", "liked", "mixed", "disliked", "neutral"],
                description: "Creator's sentiment about this book based on the transcript",
              },
              creator_quote: {
                type: "string",
                description: "Direct quote or close paraphrase of what the creator said about this book (max 2 sentences)",
              },
            },
            required: ["title", "author", "sentiment", "creator_quote"],
          },
        },
      },
      required: ["books"],
    },
  },
];

interface BookAgentInput {
  frames: (string | Buffer)[];
  transcript: string;
  creatorHandle?: string;
  debugUrl?: string;
  captureToolCalls?: boolean;
  /** Whether series/trilogy keywords were detected in the transcript */
  isSeriesMode?: boolean;
  /** Video duration in seconds */
  durationSeconds?: number;
}

export interface AgentToolCall {
  tool: "search_goodreads" | "confirm_book";
  input: Record<string, unknown>;
  output: Record<string, unknown> | Record<string, unknown>[];
  turn: number;
}

export interface AgentDiagnostics {
  toolCalls: AgentToolCall[];
  submittedBooks: SubmittedBook[];
  turns: number;
  totalMs: number;
  /** Phase 1 Haiku observation results */
  haikuCandidates: HaikuCandidate[];
  observeMs: number;
  verifyMs: number;
}

interface SubmittedBook {
  goodreads_id?: string | null;
  title: string;
  author: string;
  sentiment: string;
  creator_quote: string;
}

/**
 * Run the two-phase book identification pipeline.
 * Phase 1: Haiku observes all frames + full transcript (single turn, no tools)
 * Phase 2: Sonnet verifies candidates against Goodreads (multi-turn, tool use, NO images)
 *
 * Falls back to empty array on failure — never throws.
 */
export async function identifyBooksWithAgentDebug(
  input: Omit<BookAgentInput, "captureToolCalls">
): Promise<{ books: ResolvedBook[]; diagnostics: AgentDiagnostics }> {
  const result = await _identifyBooksWithAgentInternal({ ...input, captureToolCalls: true });
  return result as { books: ResolvedBook[]; diagnostics: AgentDiagnostics };
}

export async function identifyBooksWithAgent(
  input: BookAgentInput
): Promise<ResolvedBook[]> {
  const result = await _identifyBooksWithAgentInternal(input);
  if (Array.isArray(result)) return result;
  return result.books;
}

async function _identifyBooksWithAgentInternal(
  input: BookAgentInput
): Promise<ResolvedBook[] | { books: ResolvedBook[]; diagnostics: AgentDiagnostics }> {
  const agentStart = Date.now();
  const dbg = new AgentDebugLog(input.debugUrl ?? "unknown");
  const capturedToolCalls: AgentToolCall[] = [];

  try {
    // ── Phase 1: Haiku Observation ──────────────────────────────────────
    const tObserve = Date.now();
    const observation = await observeWithHaiku(
      input.frames,
      input.transcript,
      input.creatorHandle,
      input.isSeriesMode ?? false,
      dbg
    );
    const observeMs = Date.now() - tObserve;

    // Short-circuit if no candidates found
    if (observation.candidates.length === 0) {
      dbg.log("Phase 1 returned 0 candidates — skipping Phase 2");
      await dbg.flush();
      if (input.captureToolCalls) {
        return {
          books: [],
          diagnostics: {
            toolCalls: [],
            submittedBooks: [],
            turns: 0,
            totalMs: Date.now() - agentStart,
            haikuCandidates: [],
            observeMs,
            verifyMs: 0,
          },
        };
      }
      return [];
    }

    // ── Phase 2: Sonnet Verification ────────────────────────────────────
    const tVerify = Date.now();
    const submittedBooks = await verifyWithSonnet(observation, input, dbg, capturedToolCalls);
    const verifyMs = Date.now() - tVerify;

    const totalMs = Date.now() - agentStart;
    dbg.log(`Pipeline complete: Phase 1=${observeMs}ms (${observation.candidates.length} candidates), Phase 2=${verifyMs}ms, total=${totalMs}ms`);

    if (submittedBooks.length === 0) {
      dbg.log("No books submitted after both phases");
      await dbg.flush();
      if (input.captureToolCalls) {
        return {
          books: [],
          diagnostics: {
            toolCalls: capturedToolCalls,
            submittedBooks: [],
            turns: 0,
            totalMs,
            haikuCandidates: observation.candidates,
            observeMs,
            verifyMs,
          },
        };
      }
      return [];
    }

    // ── Resolve submitted books ─────────────────────────────────────────
    let resolved = await resolveSubmittedBooks(submittedBooks);
    dbg.log(`Resolved ${resolved.length} books: ${resolved.map(r => r.matched ? r.book.title : r.rawTitle).join(", ")}`);

    // ── Series expansion ────────────────────────────────────────────────
    resolved = await expandSeriesBooks(resolved, observation.candidates, dbg, observation.isSeriesVideo);

    await dbg.flush();

    if (input.captureToolCalls) {
      return {
        books: resolved,
        diagnostics: {
          toolCalls: capturedToolCalls,
          submittedBooks,
          turns: capturedToolCalls.length > 0 ? Math.max(...capturedToolCalls.map(c => c.turn)) : 0,
          totalMs,
          haikuCandidates: observation.candidates,
          observeMs,
          verifyMs,
        },
      };
    }
    return resolved;
  } catch (err) {
    dbg.log(`FATAL ERROR: ${String(err)}`);
    await dbg.flush();
    if (input.captureToolCalls) {
      return {
        books: [],
        diagnostics: {
          toolCalls: capturedToolCalls,
          submittedBooks: [],
          turns: 0,
          totalMs: Date.now() - agentStart,
          haikuCandidates: [],
          observeMs: 0,
          verifyMs: 0,
        },
      };
    }
    return [];
  }
}

/**
 * Convert the agent's submitted books into ResolvedBook format.
 * For books with goodreads_id, fetch full BookDetail.
 * For books without, return as unmatched.
 */
async function resolveSubmittedBooks(
  books: SubmittedBook[]
): Promise<ResolvedBook[]> {
  // Resolve all books in parallel (was sequential — bottleneck for 30+ book hauls)
  const resolvedAll = await Promise.all(
    books.map(async (book): Promise<ResolvedBook | null> => {
      const base = {
        creatorSentiment: book.sentiment,
        creatorQuote: book.creator_quote,
        confidence: "high" as const,
      };

      if (isJunkTitle(book.title)) {
        console.log(`[book-agent] Skipping junk: "${book.title}"`);
        return null;
      }

      if (book.goodreads_id) {
        const detail = await getBookDetail(book.goodreads_id);
        if (detail) {
          return {
            matched: true,
            book: detail,
            ...base,
          } as ResolvedBookMatched;
        }
      }

      // No Goodreads ID — check local DB first, then try Google Books
      if (book.title && book.author) {
        try {
          const supabase = getAdminClient();
          const authorLast = (book.author || "").split(" ").pop()?.toLowerCase() || "";
          const titleBase = book.title.split(":")[0].trim();

          // Check if already in our DB by title + author
          const { data: existingBook } = await supabase
            .from("books")
            .select("*")
            .ilike("title", `%${titleBase}%`)
            .ilike("author", `%${authorLast}%`)
            .not("cover_url", "is", null)
            .limit(1)
            .single();

          if (existingBook) {
            const mapped = mapDbBookInline(existingBook as Record<string, unknown>);
            return {
              matched: true,
              book: { ...mapped, ratings: [], spice: [], compositeSpice: null, tropes: [] },
              ...base,
            } as ResolvedBookMatched;
          }

          // Not in DB — search Google Books for cover + save provisional
          const query = `${book.title} ${book.author}`;
          const gbResults = await searchGoogleBooks(query);
          const bestMatch = gbResults.find((gb) => {
            const titleMatch = gb.title.toLowerCase().includes(titleBase.toLowerCase()) ||
              titleBase.toLowerCase().includes(gb.title.toLowerCase().split(":")[0]);
            const authorMatch = gb.author.toLowerCase().includes(authorLast);
            return titleMatch && authorMatch;
          });

          if (bestMatch) {
            const saved = await saveProvisionalBook(bestMatch);
            if (saved) {
              return {
                matched: true,
                book: { ...saved, ratings: [], spice: [], compositeSpice: null, tropes: [] },
                ...base,
              } as ResolvedBookMatched;
            }
          }
        } catch (err) {
          console.warn(`[book-agent] Fallback resolution failed for "${book.title}":`, err);
        }
      }

      return {
        matched: false,
        rawTitle: book.title,
        rawAuthor: book.author || null,
        ...base,
      } as ResolvedBookUnmatched;
    })
  );

  const results = resolvedAll.filter((r): r is ResolvedBook => r !== null);

  // Dedup by goodreads_id
  const seen = new Set<string>();
  return results.filter((r) => {
    if (!r.matched) return true;
    const gid = r.book.goodreadsId ?? r.book.id;
    if (seen.has(gid)) return false;
    seen.add(gid);
    return true;
  });
}

/**
 * Expand series recommendations.
 * When a creator recommends an entire series but the agent only identified
 * one representative book, pull in the sibling books from our DB.
 *
 * Only expands when isSeriesVideo is true — a general recommendations video
 * that happens to mention books in a series should NOT pull in every sibling.
 */
async function expandSeriesBooks(
  resolved: ResolvedBook[],
  candidates: HaikuCandidate[],
  dbg: AgentDebugLog,
  isSeriesVideo: boolean
): Promise<ResolvedBook[]> {
  // Only expand series when the video's explicit theme is series recommendations
  if (!isSeriesVideo) return resolved;

  // Build a set of series-recommended titles (lowercased) from Haiku candidates
  const seriesCandidateTitles = new Set(
    candidates
      .filter((c) => c.seriesRecommendation)
      .map((c) => c.title.toLowerCase())
  );

  if (seriesCandidateTitles.size === 0) return resolved;

  // Find resolved books whose candidate was a series recommendation
  const seriesNames = new Set<string>();
  const seriesRepresentatives = new Map<string, ResolvedBookMatched>(); // seriesName → representative book

  for (const r of resolved) {
    if (!r.matched) continue;
    const sn = r.book.seriesName;
    if (!sn) continue;

    // Check if this book's title (or its candidate title) was a series rec
    const titleLower = r.book.title.toLowerCase();
    const isSeriesRec = seriesCandidateTitles.has(titleLower) ||
      // Also match when Haiku used the series name as the candidate title
      candidates.some((c) =>
        c.seriesRecommendation &&
        (sn.toLowerCase().includes(c.title.toLowerCase().replace(/ series$/i, "")) ||
         c.title.toLowerCase().includes(sn.toLowerCase()))
      );

    if (isSeriesRec) {
      seriesNames.add(sn);
      if (!seriesRepresentatives.has(sn)) {
        seriesRepresentatives.set(sn, r);
      }
    }
  }

  if (seriesNames.size === 0) return resolved;

  dbg.log(`Series expansion: expanding ${seriesNames.size} series: ${Array.from(seriesNames).join(", ")}`);

  const supabase = getAdminClient();
  const { data: seriesBooks } = await supabase
    .from("books")
    .select("*")
    .eq("is_canon", true)
    .in("series_name", Array.from(seriesNames))
    .not("series_position", "is", null)
    .not("cover_url", "is", null)
    .order("series_position", { ascending: true });

  if (!seriesBooks || seriesBooks.length === 0) return resolved;

  // Collect IDs and series positions already in the resolved set
  const existingIds = new Set(
    resolved
      .filter((r): r is ResolvedBookMatched => r.matched)
      .map((r) => r.book.id)
  );
  // Track occupied series positions to skip foreign editions / duplicates
  const occupiedPositions = new Set<string>();
  for (const r of resolved) {
    if (r.matched && r.book.seriesName && r.book.seriesPosition) {
      occupiedPositions.add(`${r.book.seriesName}:${r.book.seriesPosition}`);
    }
  }

  let added = 0;
  const expanded = [...resolved];

  for (const row of seriesBooks) {
    const bookId = row.id as string;
    if (existingIds.has(bookId)) continue;

    const sn = row.series_name as string;
    const pos = row.series_position as number | null;
    const rep = seriesRepresentatives.get(sn);
    if (!rep) continue;

    // Skip if this series position is already filled (catches foreign editions)
    if (pos) {
      const posKey = `${sn}:${pos}`;
      if (occupiedPositions.has(posKey)) continue;
      occupiedPositions.add(posKey);
    }

    const mapped = mapDbBookInline(row as Record<string, unknown>);
    expanded.push({
      matched: true,
      book: { ...mapped, ratings: [], spice: [], compositeSpice: null, tropes: [] },
      creatorSentiment: rep.creatorSentiment,
      creatorQuote: rep.creatorQuote,
      confidence: "high",
    } as ResolvedBookMatched);

    existingIds.add(bookId);
    added++;
  }

  if (added > 0) {
    dbg.log(`Series expansion: added ${added} sibling books`);
  }

  return expanded;
}

/**
 * Lightweight DB row → Book mapper for fallback resolution.
 * Avoids circular import with cache.ts.
 */
function mapDbBookInline(row: Record<string, unknown>): import("@/lib/types").Book {
  return {
    id: row.id as string,
    isbn: (row.isbn as string) ?? null,
    isbn13: (row.isbn13 as string) ?? null,
    googleBooksId: (row.google_books_id as string) ?? null,
    title: row.title as string,
    author: row.author as string,
    seriesName: (row.series_name as string) ?? null,
    seriesPosition: (row.series_position as number) ?? null,
    coverUrl: (row.cover_url as string) ?? null,
    pageCount: (row.page_count as number) ?? null,
    publishedYear: (row.published_year as number) ?? null,
    publisher: (row.publisher as string) ?? null,
    description: (row.description as string) ?? null,
    aiSynopsis: (row.ai_synopsis as string) ?? null,
    goodreadsId: (row.goodreads_id as string) ?? null,
    goodreadsUrl: (row.goodreads_url as string) ?? null,
    amazonAsin: (row.amazon_asin as string) ?? null,
    romanceIoSlug: (row.romance_io_slug as string) ?? null,
    romanceIoHeatLabel: (row.romance_io_heat_label as string) ?? null,
    booktrackPrompt: (row.booktrack_prompt as string) ?? null,
    booktrackMoods: (row.booktrack_moods as string[]) ?? null,
    spotifyPlaylists: null,
    genres: (row.genres as string[]) ?? [],
    subgenre: (row.subgenre as string) ?? null,
    metadataSource: (row.metadata_source as import("@/lib/types").Book["metadataSource"]) ?? "google_books",
    slug: (row.slug as string) ?? `book-${row.id}`,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    dataRefreshedAt: (row.data_refreshed_at as string) ?? null,
    enrichmentStatus: (row.enrichment_status as import("@/lib/types").Book["enrichmentStatus"]) ?? null,
    isAudiobook: (row.is_audiobook as boolean) ?? false,
  };
}
