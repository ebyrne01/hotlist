"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────

interface QualityFlag {
  id: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug: string;
  fieldName: string;
  issueType: string;
  source: string;
  priority: string;
  ruleId: string | null;
  confidence: number;
  originalValue: string | null;
  suggestedValue: string | null;
  autoFixable: boolean;
  status: string;
  createdAt: string;
}

interface FlagResponse {
  flags: QualityFlag[];
  total: number;
  page: number;
  limit: number;
}

interface Stats {
  open: number;
  autoFixable: number;
  confirmedToday: number;
  dismissedToday: number;
}

interface CoverageMetric {
  count: number;
  pct: number;
}

interface Scorecard {
  computedAt: string;
  canonCount: number;
  coverage: {
    cover: CoverageMetric;
    synopsis: CoverageMetric;
    goodreadsRating: CoverageMetric;
    amazonRating: CoverageMetric;
    romanceIoSpice: CoverageMetric;
    tropes: CoverageMetric;
    amazonAsin: CoverageMetric;
    aiRecommendations: CoverageMetric;
  };
  flags: {
    openP0: number;
    openP1: number;
    openTotal: number;
  };
  enrichment: {
    complete: number;
    partial: number;
    pending: number;
  };
}

interface SourceHealth {
  jobType: string;
  total: number;
  succeeded: number;
  noData: number;
  failed: number;
  successRate: number;
}

interface HealthReport {
  lookbackHours: number;
  sources: SourceHealth[];
  warnings: string[];
}

interface RecentAutoFix {
  id: string;
  bookTitle: string;
  bookAuthor: string;
  fieldName: string;
  issueType: string;
  originalValue: string | null;
  suggestedValue: string | null;
  createdAt: string;
}

// ── Labels ────────────────────────────────────────────

const ISSUE_LABELS: Record<string, string> = {
  // Structural (rules engine)
  edition_artifact: "Edition in Series Name",
  publisher_collection: "Publisher Collection Series",
  numeric_only_series: "Series Name is Numeric/Generic",
  edition_in_title: "Edition Marker in Title",
  by_author_in_title: '"By Author" in Title',
  synopsis_too_short: "Synopsis Too Short",
  implausible_page_count: "Implausible Page Count",
  // Scanner
  wrong_book: "Not Romance / Wrong Genre",
  bad_synopsis: "Bad or Hallucinated Synopsis",
  series_title_mismatch: "Series/Title Mismatch",
  // Browser harness
  book_found: "Book Not Found in Search",
  cover_present: "Missing Cover",
  cover_portrait: "Wrong Cover (Audiobook)",
  enrichment_complete: "Enrichment Stalled",
  goodreads_rating_present: "Missing GR Rating",
  rating_accuracy: "Rating Inaccurate",
  spice_present: "Missing Spice Data",
  synopsis_present: "Missing Synopsis",
  // Manual triage
  junk_entry: "Junk / Not a Book",
  duplicate: "Duplicate Entry",
  foreign_edition: "Foreign Language Edition",
  wrong_edition: "Wrong Goodreads Edition",
};

const COVERAGE_LABELS: Record<string, string> = {
  cover: "Covers",
  synopsis: "Synopsis",
  goodreadsRating: "GR Rating",
  amazonRating: "AMZ Rating",
  romanceIoSpice: "Romance.io Spice",
  tropes: "Tropes",
  amazonAsin: "Amazon ASIN",
  aiRecommendations: "AI Recs",
};

const REMAP_ISSUE_TYPES = [
  "goodreads_wrong_book", "wrong_book", "wrong_edition",
  "goodreads_foreign_edition", "foreign_edition",
];

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-100 text-red-800",
  P1: "bg-orange-100 text-orange-800",
  P2: "bg-yellow-100 text-yellow-800",
  P3: "bg-gray-100 text-gray-600",
};

// ── Component ─────────────────────────────────────────

export default function QualityDashboard() {
  const [flags, setFlags] = useState<QualityFlag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("open");
  const [issueTypeFilter, setIssueTypeFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [stats, setStats] = useState<Stats>({ open: 0, autoFixable: 0, confirmedToday: 0, dismissedToday: 0 });
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const [remapInputs, setRemapInputs] = useState<Record<string, string>>({});
  const [scanRunning, setScanRunning] = useState(false);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [recentFixes, setRecentFixes] = useState<RecentAutoFix[]>([]);
  const limit = 50;

  const jsonHeaders = { "Content-Type": "application/json" };

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
        limit: String(limit),
      });
      if (issueTypeFilter) params.set("issue_type", issueTypeFilter);
      if (priorityFilter) params.set("priority", priorityFilter);

      const res = await fetch(`/api/admin/quality/flags?${params}`, {
        headers: jsonHeaders,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: FlagResponse = await res.json();
      setFlags(data.flags);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch flags:", err);
    } finally {
      setLoading(false);
    }
  }, [status, page, issueTypeFilter, priorityFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const [openRes, , confirmedRes, dismissedRes] = await Promise.all([
        fetch("/api/admin/quality/flags?status=open&limit=1"),
        fetch("/api/admin/quality/flags?status=open&limit=1"),
        fetch("/api/admin/quality/flags?status=confirmed&limit=1"),
        fetch("/api/admin/quality/flags?status=dismissed&limit=1"),
      ]);

      const openData = await openRes.json();
      const confirmedData = await confirmedRes.json();
      const dismissedData = await dismissedRes.json();

      // Count auto-fixable from open flags
      const fixableCount = openData.flags?.filter((f: QualityFlag) => f.autoFixable).length || 0;

      setStats({
        open: openData.total || 0,
        autoFixable: fixableCount,
        confirmedToday: confirmedData.total || 0,
        dismissedToday: dismissedData.total || 0,
      });
    } catch {
      // Stats are best-effort
    }
  }, []);

  const fetchScorecard = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/quality/scorecard");
      if (res.ok) setScorecard(await res.json());
    } catch { /* best-effort */ }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/quality/health");
      if (res.ok) setHealth(await res.json());
    } catch { /* best-effort */ }
  }, []);

  const fetchRecentFixes = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: "auto_fixed", limit: "10", page: "1" });
      const res = await fetch(`/api/admin/quality/flags?${params}`);
      if (res.ok) {
        const data: FlagResponse = await res.json();
        setRecentFixes(data.flags.map((f) => ({
          id: f.id,
          bookTitle: f.bookTitle,
          bookAuthor: f.bookAuthor,
          fieldName: f.fieldName,
          issueType: f.issueType,
          originalValue: f.originalValue,
          suggestedValue: f.suggestedValue,
          createdAt: f.createdAt,
        })));
      }
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    fetchFlags();
    fetchStats();
    fetchScorecard();
    fetchHealth();
    fetchRecentFixes();
  }, [fetchFlags, fetchStats, fetchScorecard, fetchHealth, fetchRecentFixes]);

  const resolveFlag = async (flagId: string, action: "confirm" | "dismiss", applyFix = false, newGoodreadsId?: string) => {
    setResolving((prev) => new Set(prev).add(flagId));
    try {
      const payload: Record<string, unknown> = { action, applyFix };
      if (newGoodreadsId) payload.newGoodreadsId = newGoodreadsId;

      const res = await fetch(`/api/admin/quality/flags/${flagId}/resolve`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // Remove from current list
        setFlags((prev) => prev.filter((f) => f.id !== flagId));
        setTotal((prev) => prev - 1);
        fetchStats();
      }
    } catch (err) {
      console.error("Resolve failed:", err);
    } finally {
      setResolving((prev) => {
        const next = new Set(prev);
        next.delete(flagId);
        return next;
      });
    }
  };

  const retagFlag = async (flagId: string, newIssueType: string) => {
    try {
      const res = await fetch(`/api/admin/quality/flags/${flagId}/retag`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ issueType: newIssueType }),
      });
      if (res.ok) {
        setFlags((prev) =>
          prev.map((f) => f.id === flagId ? { ...f, issueType: newIssueType } : f)
        );
      }
    } catch (err) {
      console.error("Retag failed:", err);
    }
  };

  const bulkAutoFix = async () => {
    const fixableFlags = flags.filter((f) => f.autoFixable && f.status === "open");
    if (fixableFlags.length === 0) return;

    if (!confirm(`Apply auto-fix to ${fixableFlags.length} flags?`)) return;

    try {
      const res = await fetch("/api/admin/quality/flags/bulk-resolve", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          flagIds: fixableFlags.map((f) => f.id),
          action: "confirm",
          applyFix: true,
        }),
      });
      if (res.ok) {
        fetchFlags();
        fetchStats();
      }
    } catch (err) {
      console.error("Bulk resolve failed:", err);
    }
  };

  const runScan = async () => {
    setScanRunning(true);
    try {
      await fetch("/api/admin/quality/scan", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ scope: "all" }),
      });
    } catch (err) {
      console.error("Scan failed:", err);
    }
    // Scan runs in background — poll for results
    setTimeout(() => {
      setScanRunning(false);
      fetchFlags();
      fetchStats();
    }, 5000);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Quality Flags</h1>
        <button
          onClick={runScan}
          disabled={scanRunning}
          className="px-4 py-2 bg-fire text-white rounded hover:bg-fire/90 disabled:opacity-50"
        >
          {scanRunning ? "Scanning..." : "Run Full Scan"}
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Open" value={stats.open} color="text-red-600" />
        <StatCard label="Auto-fixable" value={stats.autoFixable} color="text-orange-600" />
        <StatCard label="Confirmed" value={stats.confirmedToday} color="text-green-600" />
        <StatCard label="Dismissed" value={stats.dismissedToday} color="text-gray-500" />
      </div>

      {/* ── Scorecard Widget ── */}
      {scorecard && (
        <div className="border rounded p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-base">Quality Scorecard</h2>
            <span className="text-xs text-gray-400">
              {scorecard.canonCount.toLocaleString()} canon books
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(Object.entries(scorecard.coverage) as [string, CoverageMetric][]).map(([key, metric]) => (
              <CoverageBar key={key} label={COVERAGE_LABELS[key] || key} pct={metric.pct} count={metric.count} />
            ))}
          </div>
          <div className="flex gap-4 mt-3 pt-3 border-t text-xs text-gray-500">
            <span>Enrichment: {scorecard.enrichment.complete} complete, {scorecard.enrichment.partial} partial, {scorecard.enrichment.pending} pending</span>
            <span>Flags: <span className="text-red-600 font-bold">{scorecard.flags.openP0} P0</span> / <span className="text-orange-600 font-bold">{scorecard.flags.openP1} P1</span> / {scorecard.flags.openTotal} total</span>
          </div>
        </div>
      )}

      {/* ── Source Health Widget ── */}
      {health && health.sources.length > 0 && (
        <div className="border rounded p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-base">Enrichment Source Health</h2>
            <span className="text-xs text-gray-400">Last {health.lookbackHours}h</span>
          </div>
          {health.warnings.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-2 mb-3 text-xs text-red-700">
              {health.warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b">
                <tr>
                  <th className="px-2 py-1.5">Source</th>
                  <th className="px-2 py-1.5 text-right">Total</th>
                  <th className="px-2 py-1.5 text-right">Success</th>
                  <th className="px-2 py-1.5 text-right">No Data</th>
                  <th className="px-2 py-1.5 text-right">Failed</th>
                  <th className="px-2 py-1.5 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {health.sources.map((s) => (
                  <tr key={s.jobType} className="border-b last:border-0">
                    <td className="px-2 py-1.5 font-medium">{s.jobType}</td>
                    <td className="px-2 py-1.5 text-right">{s.total}</td>
                    <td className="px-2 py-1.5 text-right text-green-700">{s.succeeded}</td>
                    <td className="px-2 py-1.5 text-right text-yellow-600">{s.noData}</td>
                    <td className="px-2 py-1.5 text-right text-red-600">{s.failed}</td>
                    <td className="px-2 py-1.5 text-right">
                      <span className={s.successRate < 0.3 ? "text-red-600 font-bold" : s.successRate < 0.6 ? "text-yellow-600" : "text-green-700"}>
                        {Math.round(s.successRate * 100)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Recent Auto-Fixes Widget ── */}
      {recentFixes.length > 0 && (
        <div className="border rounded p-4 mb-6">
          <h2 className="font-bold text-base mb-3">Recent Auto-Fixes</h2>
          <div className="space-y-2">
            {recentFixes.map((fix) => (
              <div key={fix.id} className="flex items-start gap-3 text-xs border-b last:border-0 pb-2 last:pb-0">
                <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded shrink-0">
                  {ISSUE_LABELS[fix.issueType] || fix.issueType}
                </span>
                <div className="min-w-0">
                  <span className="font-medium">{fix.bookTitle}</span>
                  <span className="text-gray-400"> by {fix.bookAuthor}</span>
                  {fix.originalValue && (
                    <span className="text-gray-400"> — <span className="line-through">{fix.originalValue}</span></span>
                  )}
                  {fix.suggestedValue && (
                    <span className="text-green-700"> → {fix.suggestedValue}</span>
                  )}
                </div>
                <span className="text-gray-400 shrink-0 ml-auto">
                  {new Date(fix.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border rounded text-sm"
        >
          <option value="open">Open</option>
          <option value="confirmed">Confirmed</option>
          <option value="dismissed">Dismissed</option>
          <option value="auto_fixed">Auto-fixed</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border rounded text-sm"
        >
          <option value="">All Priorities</option>
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
        </select>

        <select
          value={issueTypeFilter}
          onChange={(e) => { setIssueTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border rounded text-sm"
        >
          <option value="">All Issue Types</option>
          {Object.entries(ISSUE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <button
          onClick={() => { fetchFlags(); fetchStats(); }}
          className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* Flags table */}
      {loading ? (
        <p className="text-gray-500 py-8 text-center">Loading...</p>
      ) : flags.length === 0 ? (
        <p className="text-gray-500 py-8 text-center">No flags found.</p>
      ) : (
        <>
          <div className="overflow-x-auto border rounded">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Book</th>
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">Issue</th>
                  <th className="px-3 py-2">Confidence</th>
                  <th className="px-3 py-2">Original</th>
                  <th className="px-3 py-2">Fix</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((flag) => (
                  <tr key={flag.id} className="border-b hover:bg-gray-50/50">
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${PRIORITY_COLORS[flag.priority] || ""}`}>
                        {flag.priority}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[200px]">
                      <a
                        href={`/book/${flag.bookSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-fire hover:underline block truncate"
                      >
                        {flag.bookTitle}
                      </a>
                      <span className="text-xs text-gray-400">{flag.bookAuthor}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{flag.fieldName}</td>
                    <td className="px-3 py-2">
                      {status === "open" ? (
                        <select
                          value={flag.issueType}
                          onChange={(e) => retagFlag(flag.id, e.target.value)}
                          className="px-1.5 py-0.5 border rounded text-xs bg-white max-w-[160px]"
                        >
                          {Object.entries(ISSUE_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                          {/* Show current value even if not in ISSUE_LABELS */}
                          {!ISSUE_LABELS[flag.issueType] && (
                            <option value={flag.issueType}>{flag.issueType}</option>
                          )}
                        </select>
                      ) : (
                        ISSUE_LABELS[flag.issueType] || flag.issueType
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ConfidenceBadge value={flag.confidence} />
                    </td>
                    <td className="px-3 py-2 max-w-[180px] truncate text-gray-600" title={flag.originalValue || ""}>
                      {flag.originalValue || "—"}
                    </td>
                    <td className="px-3 py-2 max-w-[180px] truncate">
                      {flag.autoFixable
                        ? flag.suggestedValue === null
                          ? <span className="text-orange-600 italic">Clear field</span>
                          : <span className="text-green-700">{flag.suggestedValue}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {status === "open" && (
                        <div className="flex flex-col gap-1">
                          {REMAP_ISSUE_TYPES.includes(flag.issueType) && (
                            <div className="flex gap-1">
                              <input
                                type="text"
                                placeholder="Correct GR ID"
                                value={remapInputs[flag.id] || ""}
                                onChange={(e) => setRemapInputs((prev) => ({ ...prev, [flag.id]: e.target.value }))}
                                className="px-1.5 py-1 border rounded text-xs w-[100px]"
                              />
                              <button
                                onClick={() => {
                                  const grId = remapInputs[flag.id]?.trim();
                                  if (!grId) return alert("Enter a Goodreads ID first");
                                  resolveFlag(flag.id, "confirm", false, grId);
                                }}
                                disabled={resolving.has(flag.id)}
                                className="px-2 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 disabled:opacity-50"
                              >
                                Remap
                              </button>
                            </div>
                          )}
                          <div className="flex gap-1">
                            {flag.autoFixable && (
                              <button
                                onClick={() => resolveFlag(flag.id, "confirm", true)}
                                disabled={resolving.has(flag.id)}
                                className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
                              >
                                Fix
                              </button>
                            )}
                            <button
                              onClick={() => resolveFlag(flag.id, "confirm")}
                              disabled={resolving.has(flag.id)}
                              className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => resolveFlag(flag.id, "dismiss")}
                              disabled={resolving.has(flag.id)}
                              className="px-2 py-1 bg-gray-400 text-white rounded text-xs hover:bg-gray-500 disabled:opacity-50"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <p className="text-gray-500">
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 border rounded text-sm disabled:opacity-30"
              >
                Prev
              </button>
              <span className="px-3 py-1 text-sm">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 border rounded text-sm disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>

          {/* Bulk auto-fix */}
          {status === "open" && flags.some((f) => f.autoFixable) && (
            <div className="mt-4 pt-4 border-t">
              <button
                onClick={bulkAutoFix}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Auto-fix All ({flags.filter((f) => f.autoFixable).length} on this page)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="border rounded p-4">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function CoverageBar({ label, pct, count }: { label: string; pct: number; count: number }) {
  const barColor =
    pct >= 90 ? "bg-green-500" :
    pct >= 70 ? "bg-yellow-500" :
    pct >= 50 ? "bg-orange-500" :
    "bg-red-500";

  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-bold">{pct}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded overflow-hidden">
        <div className={`h-full ${barColor} rounded`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-[10px] text-gray-400">{count.toLocaleString()} books</span>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 90 ? "bg-green-100 text-green-800" :
    pct >= 70 ? "bg-yellow-100 text-yellow-800" :
    "bg-red-100 text-red-800";

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold ${color}`}>
      {pct}%
    </span>
  );
}
