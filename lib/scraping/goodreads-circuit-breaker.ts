/**
 * Circuit breaker for Goodreads scraping.
 *
 * After FAILURE_THRESHOLD consecutive failures (HTTP errors, network errors,
 * or empty results from known-good queries), the circuit opens and all
 * Goodreads requests are blocked for COOLDOWN_MS. After cooldown, one
 * request is allowed through (half-open). If it succeeds, the circuit
 * closes; if it fails, it reopens.
 */

let consecutiveFailures = 0;
let circuitOpenUntil: number | null = null;
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export function isCircuitOpen(): boolean {
  if (circuitOpenUntil && Date.now() < circuitOpenUntil) {
    return true;
  }
  if (circuitOpenUntil && Date.now() >= circuitOpenUntil) {
    // Half-open: allow one request through
    circuitOpenUntil = null;
    consecutiveFailures = 0;
  }
  return false;
}

export function recordSuccess(): void {
  consecutiveFailures = 0;
}

export function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    circuitOpenUntil = Date.now() + COOLDOWN_MS;
    console.error(
      `[goodreads] Circuit breaker OPEN — ${FAILURE_THRESHOLD} consecutive failures. Pausing for 1 hour.`
    );
  }
}

export function getCircuitState(): {
  open: boolean;
  consecutiveFailures: number;
  reopensAt: number | null;
} {
  return {
    open: isCircuitOpen(),
    consecutiveFailures,
    reopensAt: circuitOpenUntil,
  };
}
