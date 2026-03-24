/**
 * ENRICHMENT SOURCE HEALTH CHECK
 *
 * Monitors per-source success rates using the `outcome` column on enrichment_queue.
 * Surfaces in the enrichment worker cron response and logs warnings when a source
 * drops below the health threshold.
 */

import { getAdminClient } from "@/lib/supabase/admin";

export interface SourceHealth {
  jobType: string;
  total: number;
  succeeded: number;
  noData: number;
  failed: number;
  successRate: number;
}

export interface HealthReport {
  lookbackHours: number;
  sources: SourceHealth[];
  warnings: string[];
}

const HEALTH_THRESHOLD = 0.3; // Warn if success rate drops below 30%

/**
 * Compute health metrics for each enrichment source over a lookback window.
 */
export async function computeSourceHealth(
  lookbackHours: number = 24
): Promise<HealthReport> {
  const supabase = getAdminClient();
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const { data: jobs, error } = await supabase
    .from("enrichment_queue")
    .select("job_type, outcome, status")
    .in("status", ["completed", "failed"])
    .gte("updated_at", since);

  if (error || !jobs) {
    return { lookbackHours, sources: [], warnings: [`Failed to query enrichment_queue: ${error?.message}`] };
  }

  // Group by job_type
  const byType = new Map<string, { total: number; succeeded: number; noData: number; failed: number }>();

  for (const job of jobs) {
    const type = job.job_type as string;
    if (!byType.has(type)) {
      byType.set(type, { total: 0, succeeded: 0, noData: 0, failed: 0 });
    }
    const stats = byType.get(type)!;
    stats.total++;

    if (job.status === "failed") {
      stats.failed++;
    } else if (job.outcome === "data") {
      stats.succeeded++;
    } else if (job.outcome === "no_data") {
      stats.noData++;
    } else {
      // Legacy jobs without outcome column — count completed as succeeded
      stats.succeeded++;
    }
  }

  const sources: SourceHealth[] = [];
  const warnings: string[] = [];

  for (const [jobType, stats] of Array.from(byType.entries())) {
    const successRate = stats.total > 0 ? stats.succeeded / stats.total : 0;
    sources.push({
      jobType,
      ...stats,
      successRate: Math.round(successRate * 100) / 100,
    });

    if (stats.total >= 5 && successRate < HEALTH_THRESHOLD) {
      const msg = `[health] ${jobType}: ${Math.round(successRate * 100)}% success rate (${stats.succeeded}/${stats.total}) in last ${lookbackHours}h`;
      warnings.push(msg);
      console.warn(msg);
    }
  }

  // Sort by success rate ascending (worst first)
  sources.sort((a, b) => a.successRate - b.successRate);

  return { lookbackHours, sources, warnings };
}
