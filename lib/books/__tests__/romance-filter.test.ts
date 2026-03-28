import { describe, it, expect } from "vitest";
import { isJunkTitle, isJunkAuthor } from "../romance-filter";
import { isCompilationTitle } from "../utils";

describe("isJunkTitle", () => {
  it("rejects study guides and summaries", () => {
    expect(isJunkTitle("Summary of It Ends With Us")).toBe(true);
    expect(isJunkTitle("Study Guide for Fourth Wing")).toBe(true);
    expect(isJunkTitle("Trivia: A Court of Thorns and Roses")).toBe(true);
  });

  it("rejects journals and workbooks", () => {
    expect(isJunkTitle("My Reading Journal")).toBe(true);
    expect(isJunkTitle("Adult Coloring Book Flowers")).toBe(true);
    expect(isJunkTitle("Romance Novel Workbook")).toBe(true);
  });

  it("rejects box sets and omnibus editions", () => {
    expect(isJunkTitle("ACOTAR Box Set")).toBe(true);
    expect(isJunkTitle("The Complete Series")).toBe(true);
    expect(isJunkTitle("Books 1-3 Omnibus")).toBe(true);
  });

  it("rejects collector and special editions", () => {
    expect(isJunkTitle("The Complete Works of Jane Austen (Collector's Edition)")).toBe(true);
    expect(isJunkTitle("Anniversary Edition of Pride and Prejudice")).toBe(true);
  });

  it("accepts valid romance titles", () => {
    expect(isJunkTitle("A Court of Thorns and Roses")).toBe(false);
    expect(isJunkTitle("The Love Hypothesis")).toBe(false);
    expect(isJunkTitle("Beach Read")).toBe(false);
    expect(isJunkTitle("It Ends With Us")).toBe(false);
    expect(isJunkTitle("Fourth Wing")).toBe(false);
    expect(isJunkTitle("Twisted Love")).toBe(false);
  });

  it("accepts titles with parenthetical subtitles that aren't junk", () => {
    expect(isJunkTitle("The Kiss Quotient (The Kiss Quotient #1)")).toBe(false);
    expect(isJunkTitle("Ugly Love: A Novel")).toBe(false);
  });

  it("rejects junk authors even with valid titles", () => {
    expect(isJunkTitle("Fourth Wing", "SuperSummary")).toBe(true);
    expect(isJunkTitle("Beach Read", "BookHabits")).toBe(true);
  });
});

describe("isJunkAuthor", () => {
  it("flags known parasite publishers", () => {
    expect(isJunkAuthor("SuperSummary")).toBe(true);
    expect(isJunkAuthor("BookHabits")).toBe(true);
    expect(isJunkAuthor("BookCaps")).toBe(true);
    expect(isJunkAuthor("Readtrepreneur")).toBe(true);
  });

  it("accepts real authors", () => {
    expect(isJunkAuthor("Sarah J. Maas")).toBe(false);
    expect(isJunkAuthor("Colleen Hoover")).toBe(false);
    expect(isJunkAuthor("Ali Hazelwood")).toBe(false);
  });
});

describe("isCompilationTitle", () => {
  it("detects box sets and bundles", () => {
    expect(isCompilationTitle("Books 1-3")).toBe(true);
    expect(isCompilationTitle("Complete Series")).toBe(true);
    expect(isCompilationTitle("Box Set")).toBe(true);
    expect(isCompilationTitle("Omnibus Edition")).toBe(true);
    expect(isCompilationTitle("2 Book Bundle")).toBe(true);
  });

  it("detects series bundles with separators", () => {
    expect(isCompilationTitle("Books 1 and 2")).toBe(true);
    expect(isCompilationTitle("Trilogy: The Full Collection")).toBe(true);
  });

  it("accepts standalone titles", () => {
    expect(isCompilationTitle("Fourth Wing")).toBe(false);
    expect(isCompilationTitle("The Love Hypothesis")).toBe(false);
    expect(isCompilationTitle("A Court of Thorns and Roses")).toBe(false);
  });
});
