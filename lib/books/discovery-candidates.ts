import { getAdminClient } from "@/lib/supabase/admin";

export interface DiscoveryCandidateInput {
  title: string;
  author?: string | null;
  source: string;
  sourceUrl?: string | null;
  sourceRank?: number | null;
  category?: string | null;
  demandScore: number;
  metadata?: Record<string, unknown>;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function recordDiscoveryCandidate(
  input: DiscoveryCandidateInput
): Promise<string | null> {
  const supabase = getAdminClient();
  const titleNorm = normalize(input.title);
  const authorNorm = normalize(input.author ?? "");

  if (!titleNorm) return null;

  const { data: existing, error: selectError } = await supabase
    .from("discovery_candidates")
    .select("id, demand_score, occurrence_count, metadata")
    .eq("source", input.source)
    .eq("title_norm", titleNorm)
    .eq("author_norm", authorNorm)
    .maybeSingle();

  if (selectError) {
    console.warn("[discovery-candidates] lookup failed:", selectError.message);
    return null;
  }

  const now = new Date().toISOString();

  if (existing?.id) {
    const { error } = await supabase
      .from("discovery_candidates")
      .update({
        last_seen_at: now,
        source_url: input.sourceUrl ?? null,
        source_rank: input.sourceRank ?? null,
        category: input.category ?? null,
        demand_score: Math.max(
          Number(existing.demand_score ?? 0),
          input.demandScore
        ),
        occurrence_count: Number(existing.occurrence_count ?? 1) + 1,
        metadata: {
          ...((existing.metadata as Record<string, unknown> | null) ?? {}),
          ...(input.metadata ?? {}),
        },
      })
      .eq("id", existing.id);

    if (error) {
      console.warn("[discovery-candidates] update failed:", error.message);
      return null;
    }
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from("discovery_candidates")
    .insert({
      title: input.title,
      author: input.author ?? null,
      title_norm: titleNorm,
      author_norm: authorNorm,
      source: input.source,
      source_url: input.sourceUrl ?? null,
      source_rank: input.sourceRank ?? null,
      category: input.category ?? null,
      demand_score: input.demandScore,
      occurrence_count: 1,
      status: "new",
      first_seen_at: now,
      last_seen_at: now,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[discovery-candidates] insert failed:", error.message);
    return null;
  }

  return (data?.id as string | undefined) ?? null;
}
