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

// ── Labels ────────────────────────────────────────────

const ISSUE_LABELS: Record<string, string> = {
  edition_artifact: "Edition in Series Name",
  publisher_collection: "Publisher Collection Series",
  numeric_only_series: "Series Name is Numeric/Generic",
  edition_in_title: "Edition Marker in Title",
  by_author_in_title: '"By Author" in Title',
  synopsis_too_short: "Synopsis Too Short",
  implausible_page_count: "Implausible Page Count",
  future_publish_year: "Future Publish Year",
  spice_genre_mismatch: "Spice/Genre Mismatch",
  trope_mismatch: "Trope Mismatch",
  goodreads_id_mismatch: "Wrong Goodreads Edition",
};

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
  const [scanRunning, setScanRunning] = useState(false);
  const limit = 50;

  // Use service role key from a prompt — in production this would use session auth
  const getAuthHeaders = useCallback(() => {
    const key = (document.getElementById("admin-key") as HTMLInputElement)?.value || "";
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }, []);

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
        headers: getAuthHeaders(),
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
  }, [status, page, issueTypeFilter, priorityFilter, getAuthHeaders]);

  const fetchStats = useCallback(async () => {
    try {
      const headers = getAuthHeaders();
      const [openRes, , confirmedRes, dismissedRes] = await Promise.all([
        fetch("/api/admin/quality/flags?status=open&limit=1", { headers }),
        fetch("/api/admin/quality/flags?status=open&limit=1", { headers }),
        fetch("/api/admin/quality/flags?status=confirmed&limit=1", { headers }),
        fetch("/api/admin/quality/flags?status=dismissed&limit=1", { headers }),
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
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchFlags();
    fetchStats();
  }, [fetchFlags, fetchStats]);

  const resolveFlag = async (flagId: string, action: "confirm" | "dismiss", applyFix = false) => {
    setResolving((prev) => new Set(prev).add(flagId));
    try {
      const res = await fetch(`/api/admin/quality/flags/${flagId}/resolve`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ action, applyFix }),
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

  const bulkAutoFix = async () => {
    const fixableFlags = flags.filter((f) => f.autoFixable && f.status === "open");
    if (fixableFlags.length === 0) return;

    if (!confirm(`Apply auto-fix to ${fixableFlags.length} flags?`)) return;

    try {
      const res = await fetch("/api/admin/quality/flags/bulk-resolve", {
        method: "POST",
        headers: getAuthHeaders(),
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
        headers: getAuthHeaders(),
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
      {/* Auth key input */}
      <div className="mb-6">
        <label className="block text-xs text-gray-500 mb-1">Service Role Key</label>
        <input
          id="admin-key"
          type="password"
          placeholder="Enter SUPABASE_SERVICE_ROLE_KEY..."
          className="w-full max-w-md px-3 py-2 border rounded text-sm"
          onChange={() => {
            fetchFlags();
            fetchStats();
          }}
        />
      </div>

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
                      {ISSUE_LABELS[flag.issueType] || flag.issueType}
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
