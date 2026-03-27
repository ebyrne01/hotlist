import { redirect } from "next/navigation";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api/require-admin";

export const metadata = { title: "Harvest Dashboard — Hotlist Admin" };

export default async function HarvestDashboardPage() {
  const auth = await requireAdmin();
  if ("error" in auth) redirect("/");

  const supabase = getAdminClient();

  // Recent harvests (last 30)
  const { data: harvests } = await supabase
    .from("harvest_log")
    .select("id, books_submitted, books_added, books_updated, books_skipped, sources, created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  // Aggregate stats
  const { data: totals } = await supabase
    .from("harvest_log")
    .select("books_added")
    .then(({ data }) => ({
      data: {
        allTime: data?.reduce((sum, r) => sum + (r.books_added ?? 0), 0) ?? 0,
        thisMonth: data
          ?.filter((r) => {
            // Filter handled below
            return true;
          })
          .reduce((sum, r) => sum + (r.books_added ?? 0), 0) ?? 0,
      },
    }));

  // This month count
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { data: monthData } = await supabase
    .from("harvest_log")
    .select("books_added")
    .gte("created_at", monthStart.toISOString());
  const thisMonth = monthData?.reduce((sum, r) => sum + (r.books_added ?? 0), 0) ?? 0;

  // Source frequency
  const sourceCounts: Record<string, number> = {};
  harvests?.forEach((h) => {
    const sources = h.sources as string[] | null;
    sources?.forEach((s: string) => {
      sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
    });
  });
  const topSources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 font-mono text-sm">
      <h1 className="font-display text-2xl font-bold mb-6">Harvest Dashboard</h1>

      {/* Aggregate stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="border border-ink/10 rounded-lg p-4">
          <div className="text-xs text-ink/50 uppercase tracking-wide">All-time added</div>
          <div className="text-2xl font-bold mt-1">{totals?.allTime ?? 0}</div>
        </div>
        <div className="border border-ink/10 rounded-lg p-4">
          <div className="text-xs text-ink/50 uppercase tracking-wide">This month</div>
          <div className="text-2xl font-bold mt-1">{thisMonth}</div>
        </div>
        <div className="border border-ink/10 rounded-lg p-4">
          <div className="text-xs text-ink/50 uppercase tracking-wide">Total harvests</div>
          <div className="text-2xl font-bold mt-1">{harvests?.length ?? 0}</div>
        </div>
        <div className="border border-ink/10 rounded-lg p-4">
          <div className="text-xs text-ink/50 uppercase tracking-wide">Top source</div>
          <div className="text-lg font-bold mt-1">{topSources[0]?.[0] ?? "—"}</div>
        </div>
      </div>

      {/* Top sources */}
      {topSources.length > 1 && (
        <div className="mb-8">
          <h2 className="text-xs text-ink/50 uppercase tracking-wide mb-2">Most common sources</h2>
          <div className="flex flex-wrap gap-2">
            {topSources.map(([source, count]) => (
              <span key={source} className="px-2 py-1 bg-ink/5 rounded text-xs">
                {source} ({count})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Harvest log table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ink/20 text-xs text-ink/50 uppercase tracking-wide">
              <th className="pb-2 pr-4">Date</th>
              <th className="pb-2 pr-4 text-right">Submitted</th>
              <th className="pb-2 pr-4 text-right">Added</th>
              <th className="pb-2 pr-4 text-right">Updated</th>
              <th className="pb-2 pr-4 text-right">Skipped</th>
              <th className="pb-2">Sources</th>
            </tr>
          </thead>
          <tbody>
            {(!harvests || harvests.length === 0) && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-ink/40">
                  No harvests yet. Use the Chrome extension or CSV import to get started.
                </td>
              </tr>
            )}
            {harvests?.map((h) => (
              <tr key={h.id} className="border-b border-ink/5 hover:bg-ink/[0.02]">
                <td className="py-2 pr-4 whitespace-nowrap">{fmt(h.created_at)}</td>
                <td className="py-2 pr-4 text-right">{h.books_submitted}</td>
                <td className="py-2 pr-4 text-right font-bold text-green-700">
                  {h.books_added > 0 ? `+${h.books_added}` : "0"}
                </td>
                <td className="py-2 pr-4 text-right">
                  {h.books_updated > 0 ? h.books_updated : "—"}
                </td>
                <td className="py-2 pr-4 text-right text-ink/40">{h.books_skipped}</td>
                <td className="py-2 text-xs text-ink/50">
                  {(h.sources as string[] | null)?.join(", ") ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
