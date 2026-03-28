"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Application {
  id: string;
  userId: string;
  status: string;
  platform: string;
  handleUrl: string;
  followerCount: number;
  contentDescription: string;
  createdAt: string;
  reviewerNote: string | null;
  reviewedAt: string | null;
  claimHandleId: string | null;
  applicantName: string;
  applicantAvatar: string | null;
}

interface Counts {
  pending: number;
  approved: number;
  rejected: number;
}

const STATUS_TABS = ["pending", "approved", "rejected"] as const;

export default function AdminCreatorsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending: 0, approved: 0, rejected: 0 });
  const [activeTab, setActiveTab] = useState<string>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/creators?status=${activeTab}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setApplications(data.applications);
      setCounts(data.counts);
    } catch {
      setError("Failed to load applications.");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  async function handleReview(id: string, action: "approve" | "reject", note?: string) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/creators/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Action failed.");
        return;
      }
      setRejectingId(null);
      setRejectNote("");
      fetchApplications();
    } catch {
      setError("Action failed. Please try again.");
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function platformIcon(platform: string) {
    switch (platform) {
      case "tiktok": return "🎵";
      case "instagram": return "📸";
      case "youtube": return "🎬";
      case "blog": return "📝";
      default: return "🌐";
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 font-body text-ink">
      <h1 className="font-display text-3xl mb-6">Creator Applications</h1>

      {/* Stats */}
      <div className="flex gap-4 mb-6">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-mono transition-colors ${
              activeTab === tab
                ? "bg-fire text-white"
                : "bg-cream border border-ink/10 text-ink/70 hover:border-fire/30"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}{" "}
            <span className="opacity-70">({counts[tab as keyof Counts]})</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-ink/50 font-mono text-sm py-12 text-center">Loading...</div>
      ) : applications.length === 0 ? (
        <div className="text-ink/50 font-mono text-sm py-12 text-center">
          No {activeTab} applications.
        </div>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <div
              key={app.id}
              className="border border-ink/10 rounded-xl p-5 bg-white"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  {app.applicantAvatar ? (
                    <img
                      src={app.applicantAvatar}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-fire/10 flex items-center justify-center text-fire font-display text-lg">
                      {app.applicantName.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div className="font-display text-lg">{app.applicantName}</div>
                    <div className="text-sm text-ink/50 font-mono">
                      {platformIcon(app.platform)} {app.platform} · {app.handleUrl}
                      {app.followerCount > 0 && ` · ${app.followerCount.toLocaleString()} followers`}
                    </div>
                  </div>
                </div>
                <div className="text-sm text-ink/40 font-mono shrink-0">
                  {formatDate(app.createdAt)}
                </div>
              </div>

              {app.claimHandleId && (
                <Link
                  href={`/discover/@${app.handleUrl?.replace(/^@/, "")}`}
                  className="mt-2 inline-block bg-amber-50 border border-amber-200 text-amber-700 text-xs font-mono px-2 py-1 rounded hover:border-amber-400 transition-colors"
                >
                  Claiming @{app.handleUrl?.replace(/^@/, "")} &rarr;
                </Link>
              )}

              {!app.claimHandleId && app.handleUrl && (
                <div className="mt-2 text-xs font-mono text-muted">
                  {app.platform === "blog" ? (
                    <a
                      href={app.handleUrl.startsWith("http") ? app.handleUrl : `https://${app.handleUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-fire transition-colors"
                    >
                      {app.handleUrl} &#8599;
                    </a>
                  ) : (
                    <span>@{app.handleUrl.replace(/^@/, "")}</span>
                  )}
                </div>
              )}

              {app.contentDescription && (
                <p className="mt-3 text-sm text-ink/70 leading-relaxed">
                  {app.contentDescription}
                </p>
              )}

              {app.reviewerNote && (
                <p className="mt-2 text-sm text-ink/50 italic">
                  Note: {app.reviewerNote}
                </p>
              )}

              {app.reviewedAt && (
                <div className="mt-2 text-xs text-ink/40 font-mono">
                  Reviewed {formatDate(app.reviewedAt)}
                </div>
              )}

              {/* Actions for pending applications */}
              {app.status === "pending" && (
                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => handleReview(app.id, "approve")}
                    disabled={actionLoading === app.id}
                    className="px-4 py-2 bg-green-600 text-white text-sm font-mono rounded-lg hover:bg-green-700 transition-colors disabled:opacity-40"
                  >
                    {actionLoading === app.id ? "..." : "Approve"}
                  </button>

                  {rejectingId === app.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Optional note for applicant..."
                        className="flex-1 px-3 py-2 border border-ink/20 rounded-lg text-sm font-body"
                      />
                      <button
                        onClick={() => handleReview(app.id, "reject", rejectNote)}
                        disabled={actionLoading === app.id}
                        className="px-4 py-2 bg-red-600 text-white text-sm font-mono rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => { setRejectingId(null); setRejectNote(""); }}
                        className="px-3 py-2 text-sm text-ink/50 hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setRejectingId(app.id)}
                      className="px-4 py-2 border border-red-200 text-red-600 text-sm font-mono rounded-lg hover:bg-red-50 transition-colors"
                    >
                      Reject
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
