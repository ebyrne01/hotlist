import { describe, it, expect } from "vitest";
import { computeFromSignals, type SpiceSignal } from "../compute-composite";

describe("computeFromSignals", () => {
  it("returns null for empty signals", () => {
    expect(computeFromSignals([])).toBeNull();
  });

  it("computes score from a single community signal", () => {
    const signals: SpiceSignal[] = [
      { source: "community", spiceValue: 4.0, confidence: 0.8, evidence: { rating_count: 25 } },
    ];
    const result = computeFromSignals(signals);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(4.0);
    expect(result!.primarySource).toBe("community");
    expect(result!.communityCount).toBe(25);
    expect(result!.signalCount).toBe(1);
    expect(result!.conflictFlag).toBe(false);
  });

  it("computes weighted average from multiple signals", () => {
    const signals: SpiceSignal[] = [
      { source: "community", spiceValue: 4.0, confidence: 0.8, evidence: { rating_count: 10 } },
      { source: "romance_io", spiceValue: 3.0, confidence: 0.85, evidence: {} },
    ];
    const result = computeFromSignals(signals);
    expect(result).not.toBeNull();
    // community: weight=0.8*1.0=0.8, romance_io: weight=0.85*0.85=0.7225
    // weighted avg = (4*0.8 + 3*0.7225) / (0.8 + 0.7225)
    expect(result!.score).toBeGreaterThan(3.0);
    expect(result!.score).toBeLessThan(4.0);
    expect(result!.signalCount).toBe(2);
  });

  it("picks highest-weight source as primary", () => {
    const signals: SpiceSignal[] = [
      { source: "genre_bucketing", spiceValue: 3.0, confidence: 0.5, evidence: {} },
      { source: "community", spiceValue: 4.0, confidence: 0.9, evidence: { rating_count: 50 } },
    ];
    const result = computeFromSignals(signals);
    expect(result!.primarySource).toBe("community");
  });

  it("detects conflict when signals disagree by > 2.0", () => {
    const signals: SpiceSignal[] = [
      { source: "community", spiceValue: 1.0, confidence: 0.8, evidence: { rating_count: 5 } },
      { source: "llm_inference", spiceValue: 5.0, confidence: 0.6, evidence: {} },
    ];
    const result = computeFromSignals(signals);
    expect(result!.conflictFlag).toBe(true);
    expect(result!.attribution).toContain("vary");
  });

  it("does not flag conflict when signals agree within 2.0", () => {
    const signals: SpiceSignal[] = [
      { source: "community", spiceValue: 3.0, confidence: 0.8, evidence: { rating_count: 5 } },
      { source: "romance_io", spiceValue: 4.0, confidence: 0.7, evidence: {} },
    ];
    const result = computeFromSignals(signals);
    expect(result!.conflictFlag).toBe(false);
  });

  it("handles all five signal sources", () => {
    const signals: SpiceSignal[] = [
      { source: "community", spiceValue: 3.5, confidence: 0.9, evidence: { rating_count: 100 } },
      { source: "romance_io", spiceValue: 4.0, confidence: 0.85, evidence: {} },
      { source: "review_classifier", spiceValue: 3.0, confidence: 0.5, evidence: {} },
      { source: "llm_inference", spiceValue: 3.5, confidence: 0.6, evidence: {} },
      { source: "genre_bucketing", spiceValue: 3.0, confidence: 0.3, evidence: {} },
    ];
    const result = computeFromSignals(signals);
    expect(result).not.toBeNull();
    expect(result!.signalCount).toBe(5);
    expect(result!.score).toBeGreaterThanOrEqual(1);
    expect(result!.score).toBeLessThanOrEqual(5);
    expect(result!.communityCount).toBe(100);
  });

  it("handles unknown source with fallback weight", () => {
    const signals: SpiceSignal[] = [
      { source: "unknown_source" as SpiceSignal["source"], spiceValue: 3.0, confidence: 0.5, evidence: {} },
    ];
    const result = computeFromSignals(signals);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(3.0);
  });
});
