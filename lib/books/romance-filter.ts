/**
 * ROMANCE FILTER GUARD
 *
 * Prevents non-romance books from appearing anywhere in Hotlist.
 * Used in search results, homepage rows, and book detail.
 */

import type { BookDetail } from "@/lib/types";

const ROMANCE_GENRE_TERMS = [
  "romance",
  "romantasy",
  "paranormal romance",
  "contemporary romance",
  "historical romance",
  "fantasy romance",
  "dark romance",
  "erotic romance",
  "romantic suspense",
  "romantic comedy",
  "new adult",
  "romantic fantasy",
  "love",
];

const ROMANCE_TROPE_SLUGS = new Set([
  "enemies-to-lovers",
  "slow-burn",
  "forced-proximity",
  "second-chance",
  "fake-dating",
  "grumpy-sunshine",
  "forbidden-romance",
  "fae-faerie",
  "instalove",
  "age-gap",
  "reverse-harem",
  "arranged-marriage",
  "bodyguard-romance",
  "sports-romance",
  "small-town",
  "billionaire",
  "dark-romance",
  "vampire",
  "shifter",
  "mafia-romance",
  "office-romance",
  "holiday-romance",
  "friends-to-lovers",
  "love-triangle",
]);

const JUNK_TITLE_PATTERNS =
  /\b(box\s*set|boxed set|collection set|bundle|omnibus|books?\s+\d+-\d+|\d+-book|complete\s+series|the\s+complete|books?\s+\d+\s*[-–&]\s*\d+|volumes?\s+\d+\s*[-–]\s*\d+|study guide|summary of|trivia|journal|workbook|coloring book|conversation starters|supersummary|bookhabits|untitled|cliff\s*notes|hardcover box|paperback box|omnibus edition|deluxe\s+limited\s+edition|special\s+edition|collector'?s?\s+edition|anniversary\s+edition|illustrated\s+edition|how well do you know|quiz|test your knowledge|unofficial guide|companion guide|discussion questions|reading guide|reader.?s guide|book club questions|essay|analysis of|literary analysis|critical analysis|study companion|bi-centenary|centenary|proceedings|symposium|conference|dissertation|thesis|municipal|township|genealogy|census)\b/i;

/** Matches slash-separated compilation titles with 2+ separators */
const MULTI_TITLE_PATTERN = /\s+\/\s+.+\s+\/\s+/;

const FOREIGN_EDITION_PATTERN =
  /\(\s*(spanish|french|german|italian|portuguese|dutch|swedish|norwegian|danish|finnish|polish|czech|hungarian|romanian|turkish|arabic|chinese|japanese|korean|russian|hindi|bengali|urdu|thai|vietnamese|indonesian|malay|tagalog|catalan|galician|basque)\s+edition\s*\)/i;

// Known romance/romantasy authors — strong positive signal
const KNOWN_ROMANCE_AUTHORS = new Set([
  "emily henry",
  "colleen hoover",
  "ali hazelwood",
  "sarah j. maas",
  "rebecca yarros",
  "jennifer l. armentrout",
  "penelope douglas",
  "lucy score",
  "helena hunting",
  "tessa bailey",
  "kennedy ryan",
  "kerri maniscalco",
  "callie hart",
  "lauren roberts",
  "caroline peckham",
  "helen hoang",
  "elena arkas",
  "diana gabaldon",
  "nora roberts",
  "nicholas sparks",
  "cassandra clare",
  "holly black",
  "abby jimenez",
  "lynn painter",
  "elsie silver",
  "hannah grace",
  "ana huang",
  "jane austen",
  "talia hibbert",
  "jasmine guillory",
  "christina lauren",
  "kresley cole",
  "lisa kleypas",
  "julie garwood",
  "kristen ashley",
  "mariana zapata",
  "l.j. shen",
  "elle kennedy",
]);

/**
 * Check if a single book is romance/romantasy.
 *
 * Passes if ANY of:
 * - Its genres array contains a romance-related term
 * - It has at least one romance-related trope tag
 * - It was manually approved (metadata_source = 'manual')
 * - Its author is a known romance author
 */
export function isRomanceBook(book: BookDetail): boolean {
  // Check genres
  if (book.genres) {
    for (const genre of book.genres) {
      const lower = genre.toLowerCase();
      if (ROMANCE_GENRE_TERMS.some((term) => lower.includes(term))) {
        return true;
      }
    }
  }

  // Check tropes
  if (book.tropes.some((t) => ROMANCE_TROPE_SLUGS.has(t.slug))) {
    return true;
  }

  // Check known authors
  const authorLower = book.author.toLowerCase();
  for (const knownAuthor of Array.from(KNOWN_ROMANCE_AUTHORS)) {
    if (authorLower.includes(knownAuthor)) return true;
  }

  // Check metadata_source
  if (book.metadataSource === "manual") return true;

  // If no genre data and no tropes, we can't be sure — let it through
  // (it'll be flagged as unverified)
  if ((!book.genres || book.genres.length === 0) && book.tropes.length === 0) {
    return true;
  }

  return false;
}

/**
 * Check if a book passes from simple genre strings (no full BookDetail needed).
 */
export function isRomanceByGenres(genres: string[]): boolean {
  for (const genre of genres) {
    const lower = genre.toLowerCase();
    if (ROMANCE_GENRE_TERMS.some((term) => lower.includes(term))) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a book title is junk (box set, study guide, etc.)
 */
export function isJunkTitle(title: string): boolean {
  return (
    JUNK_TITLE_PATTERNS.test(title) ||
    FOREIGN_EDITION_PATTERN.test(title) ||
    MULTI_TITLE_PATTERN.test(title)
  );
}

/**
 * Filter an array of books to only romance/romantasy titles.
 * Also removes junk titles.
 */
export function filterRomanceBooks(books: BookDetail[]): BookDetail[] {
  return books.filter((book) => {
    if (isJunkTitle(book.title)) return false;
    return isRomanceBook(book);
  });
}

/**
 * Check if an author is a known romance author.
 */
export function isKnownRomanceAuthor(author: string): boolean {
  const authorLower = author.toLowerCase();
  for (const knownAuthor of Array.from(KNOWN_ROMANCE_AUTHORS)) {
    if (authorLower.includes(knownAuthor)) return true;
  }
  return false;
}
