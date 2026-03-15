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
import { searchGoodreads, type GoodreadsSearchResult } from "@/lib/books/goodreads-search";
import { getBookDetail } from "@/lib/books";
import { isJunkTitle } from "@/lib/books/romance-filter";
import { getAdminClient } from "@/lib/supabase/admin";
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
const AGENT_TIME_BUDGET_MS = 180_000; // 3 minutes — leaves headroom within the 5-min Vercel timeout

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "search_goodreads",
    description:
      "Search Goodreads for a book by title, author, or series name. Returns up to 5 results with title, author, Goodreads ID, rating, and rating count. Use this to verify book identities and find the correct edition. For series, search for the series name + author to find Book 1.",
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
5. CONFIRM: Use confirm_book to verify you have the right edition (especially Book 1 for series recommendations). Call confirm_book for ALL books in a SINGLE turn.
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
- You may have the title wrong. Try the AUTHOR NAME ALONE (e.g. "Katie Reus") — this often surfaces the right book.
- Try partial or alternate title spellings. Video audio can be misheard — "Ancients Rising" might be "Ancient Protector".
- Try shorter queries: just the most distinctive word + author.
- Do NOT repeat the same failing query with minor keyword changes — change your approach entirely.`;

interface BookAgentInput {
  frames: (string | Buffer)[];
  transcript: string;
  creatorHandle?: string;
  debugUrl?: string;
  captureToolCalls?: boolean;
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
    contentBlocks.push({
      type: "text",
      text: `${handleNote}These are ${frames.length} sequential frames from a BookTok video. Below is the audio transcript.

TRANSCRIPT:
${input.transcript.slice(0, 3000)}

Identify every book the creator is recommending or discussing. Use search_goodreads to verify each one, then call submit_books with your final list. IMPORTANT: Batch all search_goodreads calls into a single turn for efficiency.`,
    });

    // Agentic loop — process tool calls until submit_books is called
    let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: contentBlocks }];
    let submittedBooks: SubmittedBook[] | null = null;
    const maxTurns = 10; // Safety limit
    let turn = 0;

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
              const results = await searchGoodreads(query);
              const simplified = results.slice(0, 5).map((r: GoodreadsSearchResult) => ({
                goodreads_id: r.goodreadsId,
                title: r.title,
                author: r.author,
                rating: r.rating,
                rating_count: r.ratingCount,
              }));
              dbg.log(`search_goodreads("${query}") => ${simplified.length} results: ${simplified.map(s => `${s.title} (${s.goodreads_id})`).join(", ")}`);
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
      dbg.log(`No books submitted after ${turn} turns`);
      await dbg.flush();
      if (input.captureToolCalls) {
        return { books: [], diagnostics: { toolCalls: capturedToolCalls, submittedBooks: [], turns: turn, totalMs: Date.now() - agentStart } };
      }
      return [];
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
