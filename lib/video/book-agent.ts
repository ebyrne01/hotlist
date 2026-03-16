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

const MODEL = "claude-sonnet-4-6";

/** Max frames to send to the agent — more frames = slower + more expensive */
const MAX_AGENT_FRAMES = 8;

/** Time budget for the agent loop (ms). After this, the agent will be asked to submit immediately. */
const AGENT_TIME_BUDGET_MS = 220_000; // 3m 40s — leaves headroom within the 4.5-min pipeline timeout

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
      "Confirm a book identification by its Goodreads ID. Returns full book detail including series name, series position, genres, and description. Use this after search_goodreads to verify you have the RIGHT book (correct edition, Book 1 of a series, etc).",
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

const SYSTEM_PROMPT = `You are a book identification agent for a BookTok video analysis tool. You receive video frames and a transcript from a BookTok/BookStagram video. Your job is to identify every book the creator is recommending, reviewing, or discussing.

YOUR PROCESS:
1. WATCH: Look at the video frames for book covers. Read titles and authors directly from what's visible.
2. LISTEN: Read the transcript to understand which books the creator is discussing and what they say about each one.
3. CROSS-REFERENCE: Match what you see on covers with what you hear in the transcript. The creator may show Book 3 while recommending Book 1 of a series.
4. VERIFY: Use search_goodreads to find each book. This is CRITICAL — do not guess at Goodreads IDs, always search. Call search_goodreads for ALL books in a SINGLE turn to save time.
5. CONFIRM: If search results already include series_name and series_position (source: "local_db"), you can skip confirm_book for those. Only use confirm_book when you need series info that wasn't in the search results (source: "google_books" or "goodreads"). Call confirm_book for ALL books in a SINGLE turn.
6. SUBMIT: Call submit_books with your final verified list.

CRITICAL RULES:
- ALWAYS use search_goodreads to verify books. Never guess.
- BATCH your tool calls: call search_goodreads for ALL books in one turn, then confirm_book for ALL in the next turn. Do NOT search one book at a time.
- When the creator recommends a SERIES, find Book 1. Search for "[series name] [author]" and use confirm_book to verify series_position is 1.
- When you see a book cover that shows a LATER book in a series (e.g., Book 3) but the creator is recommending the series from the start, search for Book 1.
- Read book covers CHARACTER BY CHARACTER — do not substitute titles you think you recognize.
- Extract sentiment and a creator quote for each book from the transcript.
- Do NOT extract books mentioned only as brief comparisons ("similar to X", "if you liked X").
- Do NOT extract planners, journals, non-book products.
- If you cannot verify a book on Goodreads, still include it with null goodreads_id.
- Call submit_books exactly ONCE with ALL books when you are done.

SEARCH STRATEGY when a search returns 0 results:
- Try the TITLE ALONE without the author name — Whisper may have garbled the author name, poisoning the query.
- Try the AUTHOR NAME ALONE (e.g. "Katie Reus") — this often surfaces the right book.
- Try partial or alternate title spellings. Video audio can be misheard — "Ancients Rising" might be "Ancient Protector".
- Try shorter queries: just the most distinctive word + author.
- If author + title together return 0, ALWAYS try the title by itself as one of your retries.
- Do NOT repeat the same failing query with minor keyword changes — change your approach entirely.
- NEVER add descriptive keywords like "dragon shifter", "magical academy", "fantasy romance", "completed trilogy" etc. to searches. Goodreads search matches on title/author text only — descriptive words poison the results. Search "Avalon Tower" not "Avalon Tower fairy spies Arthurian academy".
- Limit retries to 2-3 per book. If 3 different search strategies fail, submit the book with null goodreads_id and move on.

// Examples sourced from BookTok test harness baseline run (March 2026)
// Update when new failure patterns are identified

KNOWN WHISPER ERRORS — the transcript may contain these garbled versions:
- "Sara J. Mass" or "Sarah J. Moss" → Author is Sarah J. Maas
- "Rebecca Yarrows" or "Rebecca Yarrose" or "Rebecca Yaros" → Author is Rebecca Yarros
- "Anna Wong" or "Ana Wong" → Author is Ana Huang
- "HD Carlton" → Author is H.D. Carlton (use periods in initials)
- "Kayleen Hoover" or "Colleen Hover" → Author is Colleen Hoover
- "Kristen Hanna" → Author is Kristin Hannah
- "McKaylee Smeltzer" or "Micalee Smeltzer" → Author is Micalea Smeltzer
- "Rachel Gillick" or "Rachel Gillik" → Author is Rachel Gillig
- "Kristen Cicirelli" or "Kristen Chiccarelli" → Author is Kristen Ciccarelli
- "Cynlyn Yu" or "Sinlin Yu" → Author is SenLinYu
- "Debney Perry" → Author is Devney Perry
- "Katie Rogan" → Author is Katy Rogan
- "Court of Thorns and Roses" → Full title is "A Court of Thorns and Roses" (don't drop the article "A")
- "On a Storm" or "Onyx Store" → Book is "Onyx Storm" by Rebecca Yarros
- "Iron Frame" → Book is "Iron Flame" by Rebecca Yarros
- "The Night in the Moth" → Book is "The Knight and the Moth" by Rachel Gillig
- "Rose and Chains" → Book is "Rose in Chains" by Julie Soto
- "Infantness of Yesterday" → Book is "The Infiniteness of Yesterday" by Micalea Smeltzer
- "Alchemized" or "Alchemist" → Book may be "Alchemised" by SenLinYu
- "Ashes of Thesmar" or "Thesmar" → Series is "The Ashes of Thezmarr" by Helen Scheuerer
- "Power of Hayes" or "Hades Trials" → Series is "The Hades Trials" by Eliza Raine
When the transcript contains garbled names, search Goodreads with the CORRECTED version.

COMMON BOOKTOK ABBREVIATIONS — creators use these shorthand names:
- "ACOTAR" → "A Court of Thorns and Roses" by Sarah J. Maas (Book 1 of the series)
- "ACOSF" → "A Court of Silver Flames" by Sarah J. Maas (Book 5)
- "FBAA" → "From Blood and Ash" by Jennifer L. Armentrout
- "TOG" → "Throne of Glass" by Sarah J. Maas
- "KOA" → "Kingdom of Ash" by Sarah J. Maas
- "CC" → "House of Earth and Blood" by Sarah J. Maas (Crescent City Book 1)
- "TLH" → "The Love Hypothesis" by Ali Hazelwood
When you hear an abbreviation, search for the full title on Goodreads.

SERIES HANDLING — critical patterns:
- When a creator casually recommends a series ("you HAVE to read [series name]") → find Book 1.
- When a creator holds up Book 3 of a series → still recommend Book 1 unless they specifically say "start with Book 3".
- When a creator says "I just finished [Book 5]" → they may be recommending the series (Book 1) OR specifically that book. Use context to decide.
- When a creator says they gave a specific book 5 stars, extract THAT specific book, not Book 1 of its series.
- Verify series position with confirm_book BEFORE submitting.

COMPLETE SERIES / TRILOGY RECOMMENDATIONS:
- When the video theme is about recommending complete series or trilogies (e.g., "trilogy recommendations", "completed series you need to read", or the creator shows/names ALL books in a series), submit EVERY book in the series — NOT just Book 1.
- After confirming Book 1, search for the other books by series name + "book 2", "book 3", etc. Example: if Book 1 is "A Dawn of Onyx (The Sacred Stones, #1)", search "A Promise of Peridot Sacred Stones" and "A Reign of Rose Sacred Stones" to find Books 2 and 3.
- The creator may hold up 3 books with only spines visible — read what you can from spines and cross-reference with the transcript to identify all volumes.
- When a creator says "this whole trilogy" or "all three books", that means submit all books in the series, not just Book 1.

DO NOT EXTRACT — these are NOT book recommendations:
- Brief comparisons: "it's like a dark Twilight" → do NOT extract Twilight
- Author mentions without a specific book: "anything by Emily Henry" → do NOT extract
- DNF/negative mentions: "I DNF'd this at chapter 3" → do NOT extract
- Planners, journals, bookmarks, candles, or non-book products shown on screen
- Audiobook platform mentions: "I listened on Audible" → do NOT extract "Audible"

READING COVERS AND TEXT OVERLAYS:
- Read book covers CHARACTER BY CHARACTER. Do not assume a title based on cover art style.
- Text overlays often list books in a numbered format. Read each line carefully.
- If a cover is partially obscured, search for your best guess of the visible text + the author name from the transcript.
- Creators sometimes show a stack of books quickly. Each visible cover is a potential recommendation.

PHOTO/CAROUSEL POSTS:
- Some posts are photo carousels (slideshows), not videos. The transcript will say "this is a photo/carousel post."
- Each image is a separate slide — look at ALL of them for book covers, titles, or text overlays.
- Carousel posts often have text overlays listing book titles and authors. Read these carefully.
- Do NOT infer books from the creator's username or handle. "@abbysbooks" does NOT mean the book is by an author named Abby.
- If the transcript is just background music lyrics (love songs, pop music), ignore it entirely and rely only on the images.

ANTI-HALLUCINATION:
- NEVER guess a book based on the creator's handle or username. The handle "@romancereads" tells you nothing about which specific books are shown.
- If you can only see a partial or blurry cover and cannot read the title, do NOT guess. Skip that book.
- Only submit books you can actually read the title of (from covers or text) or hear named in the transcript.
- If you see a single ambiguous image with no readable text and no useful transcript, it is better to submit 0 books than to guess wrong.`;

interface BookAgentInput {
  frames: (string | Buffer)[];
  transcript: string;
  creatorHandle?: string;
  debugUrl?: string;
  captureToolCalls?: boolean;
  /** Pre-extracted series hints from Haiku preprocessing (series mode) */
  seriesHints?: { seriesName: string; author: string; bookCount?: number }[];
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
}

interface SubmittedBook {
  goodreads_id?: string | null;
  title: string;
  author: string;
  sentiment: string;
  creator_quote: string;
}

/**
 * Subsample frames evenly to stay under MAX_AGENT_FRAMES.
 * Keeps first and last frame, evenly spaces the rest.
 */
function subsampleFrames(frames: (string | Buffer)[]): (string | Buffer)[] {
  if (frames.length <= MAX_AGENT_FRAMES) return frames;

  const result: (string | Buffer)[] = [frames[0]];
  const step = (frames.length - 1) / (MAX_AGENT_FRAMES - 1);
  for (let i = 1; i < MAX_AGENT_FRAMES - 1; i++) {
    result.push(frames[Math.round(i * step)]);
  }
  result.push(frames[frames.length - 1]);
  return result;
}

/**
 * Run the book identification agent.
 *
 * Sends video frames + transcript to Sonnet with tool access to Goodreads.
 * Sonnet identifies books, verifies them against Goodreads, and returns
 * canonical results — all in one call.
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    dbg.log("ERROR: Missing ANTHROPIC_API_KEY");
    await dbg.flush();
    return [];
  }

  const capturedToolCalls: AgentToolCall[] = [];

  try {
    const client = new Anthropic({ apiKey });

    // Subsample frames to keep request size manageable
    const frames = subsampleFrames(input.frames);
    dbg.log(`Using ${frames.length} frames (from ${input.frames.length} total), transcript length=${input.transcript.length}`);

    // Build the user message with frames + transcript
    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];

    // Add video frames as images
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

    // Add transcript text
    const handleNote = input.creatorHandle
      ? `Video by ${input.creatorHandle}.\n\n`
      : "";
    const isCarousel = input.transcript.includes("photo/carousel post");
    const mediaDescription = isCarousel
      ? `These are ${frames.length} images from a BookTok photo/carousel post (slideshow). Each image is a separate slide. Look at ALL slides for book covers, titles, or text overlays.`
      : `These are ${frames.length} sequential frames from a BookTok video. Below is the audio transcript.`;

    // Build series mode instructions if we have pre-extracted series hints
    let seriesInstructions = "";
    if (input.seriesHints && input.seriesHints.length > 0) {
      const seriesList = input.seriesHints
        .map((s) => `- "${s.seriesName}"${s.author ? ` by ${s.author}` : ""}${s.bookCount ? ` (${s.bookCount} books)` : ""}`)
        .join("\n");
      seriesInstructions = `

SERIES MODE — This video recommends complete series/trilogies. The following series were identified from the transcript:
${seriesList}

YOUR TASK: Find ALL individual books in each series on Goodreads. Do NOT submit just Book 1 — submit every book.
STRATEGY: For each series, search for the series name + author. Confirm Book 1 to get the exact series name, then search for "Book 2 [series name]", "Book 3 [series name]", etc. Confirm each book to verify it belongs to the series.
EFFICIENCY: Search for ALL series in your first turn. Then confirm all Book 1s. Then search for remaining books in each series. Batch aggressively.`;
    }

    contentBlocks.push({
      type: "text",
      text: `${handleNote}${mediaDescription}

TRANSCRIPT:
${input.transcript.slice(0, 3000)}
${seriesInstructions}

Identify every book the creator is recommending or discussing. Use search_goodreads to verify each one, then call submit_books with your final list. IMPORTANT: Batch all search_goodreads calls into a single turn for efficiency.`,
    });

    // Agentic loop — process tool calls until submit_books is called
    let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: contentBlocks }];
    let submittedBooks: SubmittedBook[] | null = null;
    const maxTurns = 20; // Safety limit — time budget is the real limiter
    let turn = 0;

    // Track confirmed books as fallback if the agent never calls submit_books
    const confirmedBooks = new Map<string, { goodreads_id: string; title: string; author: string }>();

    while (turn < maxTurns && !submittedBooks) {
      turn++;
      const turnStart = Date.now();
      const elapsed = turnStart - agentStart;

      // If we're running low on time, ask the agent to submit what it has NOW
      if (elapsed > AGENT_TIME_BUDGET_MS && turn > 2) {
        dbg.log(`Time budget exceeded (${elapsed}ms > ${AGENT_TIME_BUDGET_MS}ms) at turn ${turn}. Requesting immediate submission.`);
        messages = [
          ...messages,
          { role: "user", content: "TIME LIMIT REACHED. You must call submit_books NOW with whatever books you have verified so far. Do not make any more search or confirm calls." },
        ];
      }

      dbg.log(`Turn ${turn}: sending request (${messages.length} messages)...`);

      let response: Anthropic.Messages.Message;
      try {
        response = await client.messages.create({
          model: MODEL,
          max_tokens: 8192,
          temperature: 0,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        });
      } catch (apiErr) {
        dbg.log(`ERROR: Anthropic API error on turn ${turn}: ${String(apiErr)}`);
        break;
      }

      const apiMs = Date.now() - turnStart;
      dbg.log(`Turn ${turn}: stop_reason=${response.stop_reason}, blocks=${response.content.map(b => b.type).join(",")}, api_ms=${apiMs}, usage=${JSON.stringify(response.usage)}`);

      // If the model stopped without tool use, we're done (or it failed)
      if (response.stop_reason === "end_turn") {
        const textBlocks = response.content.filter(b => b.type === "text");
        if (textBlocks.length > 0) {
          dbg.log(`Model stopped with text: ${(textBlocks[0] as Anthropic.Messages.TextBlock).text.slice(0, 500)}`);
        } else {
          dbg.log("Model stopped without calling submit_books (no text, no tools)");
        }
        break;
      }

      // Process tool calls
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        dbg.log("No tool calls in response despite stop_reason != end_turn");
        break;
      }

      dbg.log(`Turn ${turn}: processing ${toolUseBlocks.length} tool calls: ${toolUseBlocks.map(b => b.name).join(", ")}`);

      // Execute ALL tool calls in parallel for speed
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
              dbg.log(`search_goodreads("${query}") => ${simplified.length} results (${results[0]?.source ?? "none"}): ${simplified.map(s => `${s.title} (${s.goodreads_id})`).join(", ")}`);
              if (input.captureToolCalls) {
                capturedToolCalls.push({ tool: "search_goodreads", input: { query }, output: simplified, turn });
              }
              return {
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify(simplified),
              };
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
                if (input.captureToolCalls) {
                  capturedToolCalls.push({ tool: "confirm_book", input: { goodreads_id: goodreadsId }, output: confirmOutput, turn });
                }
                return {
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(confirmOutput),
                };
              } else {
                dbg.log(`confirm_book(${goodreadsId}) => NOT FOUND`);
                if (input.captureToolCalls) {
                  capturedToolCalls.push({ tool: "confirm_book", input: { goodreads_id: goodreadsId }, output: { error: "Book not found" }, turn });
                }
                return {
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({ error: "Book not found" }),
                };
              }
            } else if (toolUse.name === "submit_books") {
              const books = (toolInput.books as SubmittedBook[]) ?? [];
              submittedBooks = books;
              dbg.log(`submit_books(${books.length}): ${JSON.stringify(books.map((b) => ({ title: b.title, author: b.author, gid: b.goodreads_id })))}`);
              return {
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify({ status: "accepted", count: books.length }),
              };
            } else {
              dbg.log(`Unknown tool: ${toolUse.name}`);
              return {
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` }),
              };
            }
          } catch (toolErr) {
            dbg.log(`ERROR: Tool ${toolUse.name} failed: ${String(toolErr)}`);
            return {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: `Tool failed: ${String(toolErr)}` }),
              is_error: true,
            };
          }
        })
      );

      const toolMs = Date.now() - turnStart - apiMs;
      dbg.log(`Turn ${turn} complete: api=${apiMs}ms, tools=${toolMs}ms`);

      // Add assistant response + tool results to messages for next turn
      messages = [
        ...messages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];
    }

    const totalMs = Date.now() - agentStart;
    dbg.log(`Agent complete: ${turn} turns, ${totalMs}ms total`);

    if (!submittedBooks || (submittedBooks as SubmittedBook[]).length === 0) {
      // Fallback: if the agent confirmed books but never submitted (rate limit, max_tokens, etc.),
      // synthesize a submission from confirmed books
      if (confirmedBooks.size > 0) {
        dbg.log(`Agent did not call submit_books, but confirmed ${confirmedBooks.size} books. Using confirmed books as fallback.`);
        submittedBooks = Array.from(confirmedBooks.values()).map(b => ({
          goodreads_id: b.goodreads_id,
          title: b.title,
          author: b.author,
          sentiment: "positive",
          creator_quote: "",
        }));
      } else {
        dbg.log(`No books submitted after ${turn} turns`);
        await dbg.flush();
        if (input.captureToolCalls) {
          return { books: [], diagnostics: { toolCalls: capturedToolCalls, submittedBooks: [], turns: turn, totalMs: Date.now() - agentStart } };
        }
        return [];
      }
    }

    // Convert submitted books to ResolvedBook format
    const resolved = await resolveSubmittedBooks(submittedBooks as SubmittedBook[]);
    dbg.log(`Resolved ${resolved.length} books: ${resolved.map(r => r.matched ? r.book.title : r.rawTitle).join(", ")}`);
    await dbg.flush();
    if (input.captureToolCalls) {
      return { books: resolved, diagnostics: { toolCalls: capturedToolCalls, submittedBooks: submittedBooks as SubmittedBook[], turns: turn, totalMs: Date.now() - agentStart } };
    }
    return resolved;
  } catch (err) {
    dbg.log(`FATAL ERROR: ${String(err)}`);
    await dbg.flush();
    if (input.captureToolCalls) {
      return { books: [], diagnostics: { toolCalls: capturedToolCalls, submittedBooks: [], turns: 0, totalMs: Date.now() - agentStart } };
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
    genres: (row.genres as string[]) ?? [],
    subgenre: (row.subgenre as string) ?? null,
    metadataSource: (row.metadata_source as import("@/lib/types").Book["metadataSource"]) ?? "google_books",
    slug: (row.slug as string) ?? `book-${row.id}`,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    dataRefreshedAt: (row.data_refreshed_at as string) ?? null,
    enrichmentStatus: (row.enrichment_status as import("@/lib/types").Book["enrichmentStatus"]) ?? null,
  };
}
