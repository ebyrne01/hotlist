import { describe, expect, it } from "vitest";
import { buildDnaProfile, computeTropeAffinities } from "./compute";

describe("Reading DNA computation", () => {
  it("lets disliked books reduce trope affinity without creating negative scores", () => {
    const affinities = computeTropeAffinities([
      {
        bookId: "loved-1",
        weight: 1,
        tropes: ["enemies-to-lovers", "forced-proximity"],
      },
      {
        bookId: "disliked-1",
        weight: -0.5,
        tropes: ["forced-proximity", "mafia-romance"],
      },
    ]);

    expect(affinities["enemies-to-lovers"]).toBe(1);
    expect(affinities["forced-proximity"]).toBe(0.5);
    expect(affinities["mafia-romance"]).toBe(0);
  });

  it("uses explicit quiz trope picks as real profile signal", () => {
    const profile = buildDnaProfile(
      [
        {
          bookId: "liked-book",
          weight: 1,
          tropes: ["slow-burn"],
        },
        {
          bookId: "__quiz_trope_preferences__",
          weight: 0.85,
          tropes: ["dragon-riders", "fated-mates"],
        },
      ],
      [3, 4],
      []
    );

    expect(profile.tropeAffinities["slow-burn"]).toBe(1);
    expect(profile.tropeAffinities["dragon-riders"]).toBe(0.85);
    expect(profile.tropeAffinities["fated-mates"]).toBe(0.85);
    expect(profile.spicePreferred).toBe(3.5);
    expect(profile.signalCount).toBe(2);
  });
});
