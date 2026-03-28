import { describe, it, expect } from "vitest";
import {
  isCircuitOpen,
  recordSuccess,
  recordFailure,
  getCircuitState,
} from "../goodreads-circuit-breaker";

// NOTE: Module state is shared across tests in order. Tests are written
// to run sequentially, each building on the state from the previous.

describe("goodreads circuit breaker", () => {
  it("starts with circuit closed", () => {
    // Reset any leftover state
    for (let i = 0; i < 10; i++) recordSuccess();
    const state = getCircuitState();
    expect(state.open).toBe(false);
    expect(state.consecutiveFailures).toBe(0);
  });

  it("stays closed after a few failures", () => {
    recordFailure();
    recordFailure();
    recordFailure();
    expect(isCircuitOpen()).toBe(false);
    expect(getCircuitState().consecutiveFailures).toBe(3);
  });

  it("resets failure count on success", () => {
    recordSuccess();
    const state = getCircuitState();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.open).toBe(false);
  });

  it("opens after 5 consecutive failures", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure();
    }
    expect(isCircuitOpen()).toBe(true);
    const state = getCircuitState();
    expect(state.open).toBe(true);
    expect(state.reopensAt).not.toBeNull();
  });

  it("reports reopensAt timestamp when open", () => {
    const state = getCircuitState();
    expect(state.reopensAt).toBeTypeOf("number");
    expect(state.reopensAt!).toBeGreaterThan(Date.now());
  });
});
