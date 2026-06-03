import { describe, expect, it } from "vitest";
import { __testing } from "../romance-io-search";

function collectFromSnippet(snippet: string, title: string, author: string) {
  const signals = {
    bestSpice: null as { spiceLevel: number; heatLabel: string } | null,
    bestRating: null as number | null,
    allTags: [] as string[],
  };

  __testing.collectRomanceIoSignals(
    [
      {
        title: "Author latest - Romance.io",
        link: "https://www.romance.io/authors/example/latest",
        snippet,
      },
    ],
    title,
    author,
    signals,
    { allowIndexedListSnippets: true }
  );

  return signals;
}

describe("romance.io indexed snippet parsing", () => {
  it("uses exact title and author groups from author/latest snippets", () => {
    const signals = collectFromSnippet(
      "Cursed Magic (Rejected Fate Trilogy #2) · Jen L. Grey. Rated: 4.15 of 5 stars. Steam rating: 1 of 5 - Glimpses and kisses · · 24 Mar 2025.",
      "Cursed Magic",
      "Jen L. Grey"
    );

    expect(signals.bestRating).toBe(4.15);
    expect(signals.bestSpice).toEqual({
      spiceLevel: 1,
      heatLabel: "Glimpses And Kisses",
    });
  });

  it("does not steal steam from the next book in a multi-book snippet", () => {
    const signals = collectFromSnippet(
      "The Order of the Black Tapestry · Suzanne Wright. Rated: 0.00 of 5 stars · 24 May 2026 ; Black Willow Witch · Suzanne Wright. Rated: 4.24 of 5 stars. Steam rating: 4 of 5 - Explicit open door.",
      "The Order of the Black Tapestry",
      "Suzanne Wright"
    );

    expect(signals.bestRating).toBeNull();
    expect(signals.bestSpice).toBeNull();
  });

});
