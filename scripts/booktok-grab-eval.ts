/**
 * BookTok Grab Eval Harness
 *
 * Default mode is fixture-only and costs nothing:
 *   npm run booktok:eval
 *
 * Live mode intentionally spends RapidAPI/OpenAI/Anthropic budget:
 *   npm run booktok:eval:live -- --case=my-case-id
 *
 * Add live cases to scripts/fixtures/booktok-grab-eval-cases.json with:
 *   - id
 *   - url
 *   - expected.mustInclude / expected.mustNotInclude
 *
 * To freeze a known-good live output, run:
 *   npm run booktok:eval:live -- --case=my-case-id --write-fixture
 */

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import fs from "fs";
import path from "path";

type EvalBookRef = {
  title: string;
  author?: string;
};

type EvalCase = {
  id: string;
  description?: string;
  url?: string;
  expected: {
    minMatched?: number;
    mustInclude?: EvalBookRef[];
    mustNotInclude?: EvalBookRef[];
    allowUnmatched?: boolean;
  };
  result?: GrabResultLike;
};

type GrabBookLike =
  | {
      matched: true;
      book: {
        title: string;
        author: string;
        goodreadsId?: string | null;
      };
      confidence?: string;
    }
  | {
      matched: false;
      rawTitle: string;
      rawAuthor?: string | null;
      confidence?: string;
    };

type GrabResultLike =
  | {
      success: true;
      books: GrabBookLike[];
      booksFound?: number;
      processingTimeMs?: number;
    }
  | {
      success: false;
      error: string;
      transcript?: string;
    };

type EvalFailure = {
  caseId: string;
  message: string;
};

const CASES_PATH = path.join(
  process.cwd(),
  "scripts",
  "fixtures",
  "booktok-grab-eval-cases.json"
);
const RESULTS_PATH = path.join(
  process.cwd(),
  "scripts",
  "booktok-grab-eval-results.json"
);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesSimilar(actual: string, expected: string): boolean {
  const a = normalize(actual);
  const e = normalize(expected);
  if (a === e || a.includes(e) || e.includes(a)) return true;

  const actualWords = new Set(a.split(" ").filter((w) => w.length > 2));
  const expectedWords = e.split(" ").filter((w) => w.length > 2);
  if (expectedWords.length === 0) return false;

  const overlap = expectedWords.filter((word) => actualWords.has(word)).length;
  return overlap / expectedWords.length >= 0.75;
}

function authorsSimilar(actual: string, expected?: string): boolean {
  if (!expected) return true;
  const a = normalize(actual);
  const e = normalize(expected);
  return a === e || a.includes(e) || e.includes(a);
}

function matchedBooks(result: GrabResultLike): Extract<GrabBookLike, { matched: true }>[] {
  if (!result.success) return [];
  return result.books.filter(
    (book): book is Extract<GrabBookLike, { matched: true }> => book.matched
  );
}

function findBook(result: GrabResultLike, expected: EvalBookRef): boolean {
  return matchedBooks(result).some(
    (book) =>
      titlesSimilar(book.book.title, expected.title) &&
      authorsSimilar(book.book.author, expected.author)
  );
}

function evaluateCase(testCase: EvalCase, result: GrabResultLike): EvalFailure[] {
  const failures: EvalFailure[] = [];

  if (!result.success) {
    failures.push({
      caseId: testCase.id,
      message: `grab failed with ${result.error}`,
    });
    return failures;
  }

  const matched = matchedBooks(result);
  const minMatched = testCase.expected.minMatched ?? 1;
  if (matched.length < minMatched) {
    failures.push({
      caseId: testCase.id,
      message: `expected at least ${minMatched} matched book(s), got ${matched.length}`,
    });
  }

  if (!testCase.expected.allowUnmatched) {
    const unmatched = result.books.filter((book) => !book.matched);
    if (unmatched.length > 0) {
      failures.push({
        caseId: testCase.id,
        message: `expected no unmatched books, got ${unmatched.length}`,
      });
    }
  }

  for (const expected of testCase.expected.mustInclude ?? []) {
    if (!findBook(result, expected)) {
      failures.push({
        caseId: testCase.id,
        message: `missing expected book "${expected.title}"${expected.author ? ` by ${expected.author}` : ""}`,
      });
    }
  }

  for (const expected of testCase.expected.mustNotInclude ?? []) {
    if (findBook(result, expected)) {
      failures.push({
        caseId: testCase.id,
        message: `included forbidden book "${expected.title}"${expected.author ? ` by ${expected.author}` : ""}`,
      });
    }
  }

  return failures;
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  const caseArg = process.argv.find((arg) => arg.startsWith("--case="));
  return {
    live: args.has("--live"),
    writeFixture: args.has("--write-fixture"),
    caseId: caseArg?.split("=")[1],
  };
}

async function runLiveCase(testCase: EvalCase): Promise<GrabResultLike> {
  if (!testCase.url) {
    throw new Error(`Case "${testCase.id}" has no url`);
  }

  const { grabBooksFromVideo } = await import("../lib/video/index");
  return grabBooksFromVideo(testCase.url, (status) => {
    console.log(`[${testCase.id}] ${status}`);
  }) as Promise<GrabResultLike>;
}

async function main() {
  const options = parseArgs();
  const cases = JSON.parse(fs.readFileSync(CASES_PATH, "utf8")) as EvalCase[];
  const selected = options.caseId
    ? cases.filter((testCase) => testCase.id === options.caseId)
    : cases;

  if (selected.length === 0) {
    throw new Error(`No eval cases matched${options.caseId ? ` "${options.caseId}"` : ""}`);
  }

  if (options.live && !process.env.BOOKTOK_EVAL_ALLOW_LIVE) {
    throw new Error(
      "Live eval spends API budget. Set BOOKTOK_EVAL_ALLOW_LIVE=1 to confirm."
    );
  }

  const failures: EvalFailure[] = [];
  const results: Array<{
    id: string;
    mode: "fixture" | "live";
    passed: boolean;
    matchedCount: number;
    failures: string[];
  }> = [];

  for (const testCase of selected) {
    const result = options.live ? await runLiveCase(testCase) : testCase.result;
    if (!result) {
      failures.push({
        caseId: testCase.id,
        message: "fixture result missing; add result or run with --live",
      });
      results.push({
        id: testCase.id,
        mode: options.live ? "live" : "fixture",
        passed: false,
        matchedCount: 0,
        failures: ["fixture result missing; add result or run with --live"],
      });
      continue;
    }

    if (options.live && options.writeFixture) {
      testCase.result = result;
    }

    const caseFailures = evaluateCase(testCase, result);
    failures.push(...caseFailures);
    results.push({
      id: testCase.id,
      mode: options.live ? "live" : "fixture",
      passed: caseFailures.length === 0,
      matchedCount: matchedBooks(result).length,
      failures: caseFailures.map((failure) => failure.message),
    });
  }

  if (options.live && options.writeFixture) {
    fs.writeFileSync(CASES_PATH, JSON.stringify(cases, null, 2) + "\n");
  }

  fs.writeFileSync(
    RESULTS_PATH,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        mode: options.live ? "live" : "fixture",
        total: results.length,
        passed: results.filter((result) => result.passed).length,
        failed: results.filter((result) => !result.passed).length,
        results,
      },
      null,
      2
    ) + "\n"
  );

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status} ${result.id} (${result.matchedCount} matched)`);
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }

  console.log(`Results written to ${path.relative(process.cwd(), RESULTS_PATH)}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
