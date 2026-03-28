import { describe, it, expect } from "vitest";
import { classifyQuery } from "../classify-query";

describe("classifyQuery", () => {
  describe("title/author queries", () => {
    it("classifies plain book titles as title_author", () => {
      expect(classifyQuery("It Ends With Us")).toEqual({
        type: "title_author",
        query: "It Ends With Us",
      });
    });

    it("classifies author names as title_author", () => {
      expect(classifyQuery("Sarah J Maas")).toEqual({
        type: "title_author",
        query: "Sarah J Maas",
      });
    });

    it("trims whitespace", () => {
      expect(classifyQuery("  Fourth Wing  ")).toEqual({
        type: "title_author",
        query: "Fourth Wing",
      });
    });
  });

  describe("video URLs", () => {
    it("detects TikTok URLs", () => {
      const result = classifyQuery("https://www.tiktok.com/@user/video/123");
      expect(result.type).toBe("video_url");
    });

    it("detects Instagram URLs", () => {
      const result = classifyQuery("https://www.instagram.com/reel/abc123");
      expect(result.type).toBe("video_url");
    });

    it("detects YouTube URLs", () => {
      const result = classifyQuery("https://youtube.com/watch?v=abc");
      expect(result.type).toBe("video_url");
    });
  });

  describe("question queries", () => {
    it("detects 'what' questions", () => {
      const result = classifyQuery("what are the best dark romance books");
      expect(result.type).toBe("question");
    });

    it("detects recommendation requests", () => {
      const result = classifyQuery("recommend me a spicy fantasy");
      expect(result.type).toBe("question");
    });

    it("detects 'find me' requests", () => {
      const result = classifyQuery("find me a slow burn romance");
      expect(result.type).toBe("question");
    });
  });

  describe("comparison queries", () => {
    it("detects 'like' comparisons", () => {
      const result = classifyQuery("books like ACOTAR");
      expect(result.type).toBe("comparison");
    });

    it("detects 'similar to' comparisons", () => {
      const result = classifyQuery("similar to Fourth Wing");
      expect(result.type).toBe("comparison");
    });
  });

  describe("discovery queries", () => {
    it("detects trope names", () => {
      expect(classifyQuery("enemies to lovers").type).toBe("discovery");
      expect(classifyQuery("forced proximity books").type).toBe("discovery");
      expect(classifyQuery("grumpy sunshine").type).toBe("discovery");
      expect(classifyQuery("fated mates").type).toBe("discovery");
    });

    it("detects spice descriptors", () => {
      expect(classifyQuery("spicy romance").type).toBe("discovery");
      expect(classifyQuery("clean romance").type).toBe("discovery");
      expect(classifyQuery("steamy fantasy").type).toBe("discovery");
    });

    it("detects subgenre signals", () => {
      expect(classifyQuery("contemporary romance").type).toBe("discovery");
      expect(classifyQuery("paranormal romance").type).toBe("discovery");
      expect(classifyQuery("romantasy").type).toBe("discovery");
    });

    it("detects mood descriptors", () => {
      expect(classifyQuery("dark romance").type).toBe("discovery");
      expect(classifyQuery("cozy romance").type).toBe("discovery");
    });
  });
});
