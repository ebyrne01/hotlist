"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";
import { createClient } from "@/lib/supabase/client";

interface HotlistCard {
  id: string;
  name: string;
  isPublic: boolean;
  shareSlug: string | null;
  updatedAt: string;
  bookCount: number;
  sourceCreatorHandle: string | null;
  coverUrls: string[];
}

export default function MyHotlistsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [hotlists, setHotlists] = useState<HotlistCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;

    async function fetchLists() {
      const supabase = createClient();
      const { data } = await supabase
        .from("hotlists")
        .select("id, name, is_public, share_slug, updated_at, source_creator_handle, hotlist_books(count)")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false });

      const hotlistIds = (data ?? []).map((r: Record<string, unknown>) => r.id as string);

      // Fetch first 4 book covers per hotlist
      const coverMap: Record<string, string[]> = {};
      if (hotlistIds.length > 0) {
        const { data: hbRows } = await supabase
          .from("hotlist_books")
          .select("hotlist_id, position, books(cover_url)")
          .in("hotlist_id", hotlistIds)
          .order("position", { ascending: true });

        for (const row of (hbRows ?? []) as { hotlist_id: string; position: number; books: { cover_url: string | null }[] | { cover_url: string | null } | null }[]) {
          const hid = row.hotlist_id;
          const booksData = Array.isArray(row.books) ? row.books[0] : row.books;
          const url = booksData?.cover_url;
          if (!url) continue;
          if (!coverMap[hid]) coverMap[hid] = [];
          if (coverMap[hid].length < 4) coverMap[hid].push(url);
        }
      }

      const mapped: HotlistCard[] = (data ?? []).map((row: Record<string, unknown>) => {
        const countData = row.hotlist_books as { count: number }[] | undefined;
        return {
          id: row.id as string,
          name: row.name as string,
          isPublic: row.is_public as boolean,
          shareSlug: (row.share_slug as string) ?? null,
          updatedAt: row.updated_at as string,
          bookCount: countData?.[0]?.count ?? 0,
          sourceCreatorHandle: (row.source_creator_handle as string) ?? null,
          coverUrls: coverMap[row.id as string] ?? [],
        };
      });

      setHotlists(mapped);
      setLoading(false);
    }

    fetchLists();
  }, [user]);

  async function handleCreate() {
    if (!user || !newName.trim()) return;
    setCreating(true);

    try {
      const supabase = createClient();
      const shareSlug =
        newName.trim().toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .slice(0, 30) + "-" + Math.random().toString(36).slice(2, 6);

      const { data } = await supabase
        .from("hotlists")
        .insert({
          user_id: user.id,
          name: newName.trim(),
          is_public: false,
          share_slug: shareSlug,
        })
        .select("id, name, is_public, share_slug, updated_at")
        .single();

      if (data) {
        setHotlists((prev) => [
          {
            id: data.id,
            name: data.name,
            isPublic: data.is_public,
            shareSlug: data.share_slug,
            updatedAt: data.updated_at,
            bookCount: 0,
            sourceCreatorHandle: null,
            coverUrls: [],
          },
          ...prev,
        ]);
        setNewName("");
        setShowCreate(false);
      }
    } catch (err) {
      console.error("[handleCreate] failed:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this hotlist? This can't be undone.")) return;
    setDeleting(id);

    try {
      const supabase = createClient();
      await supabase.from("hotlists").delete().eq("id", id);
      setHotlists((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      console.error("[handleDelete] failed:", err);
    } finally {
      setDeleting(null);
    }
  }

  async function handleRename(id: string) {
    if (!editName.trim()) {
      setEditingId(null);
      return;
    }
    try {
      const supabase = createClient();
      await supabase.from("hotlists").update({ name: editName.trim() }).eq("id", id);
      setHotlists((prev) =>
        prev.map((h) => (h.id === id ? { ...h, name: editName.trim() } : h))
      );
    } catch (err) {
      console.error("[handleRename] failed:", err);
    } finally {
      setEditingId(null);
    }
  }

  async function handleTogglePublic(id: string, currentlyPublic: boolean) {
    try {
      const supabase = createClient();
      await supabase.from("hotlists").update({ is_public: !currentlyPublic }).eq("id", id);
      setHotlists((prev) =>
        prev.map((h) => (h.id === id ? { ...h, isPublic: !currentlyPublic } : h))
      );
    } catch (err) {
      console.error("[handleTogglePublic] failed:", err);
    }
  }

  function handleCopyLink(shareSlug: string | null, id: string) {
    const slug = shareSlug ?? id;
    const url = `${window.location.origin}/lists/${slug}`;
    navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }

  if (authLoading || loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-muted font-mono text-sm">Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">My Hotlists</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="text-sm font-mono text-fire hover:text-fire/80 transition-colors"
        >
          + Create New
        </button>
      </div>

      {/* Create new list inline */}
      {showCreate && (
        <div className="mb-6 p-4 border border-fire/20 rounded-lg bg-white">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name your hotlist..."
              className="flex-1 text-sm font-body border border-border rounded-md px-3 py-2 focus:outline-none focus:border-fire/50"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="px-4 py-2 bg-fire text-white text-sm font-mono rounded-md hover:bg-fire/90 transition-colors disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(""); }}
              className="px-3 py-2 text-sm font-mono text-muted hover:text-ink transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Hotlist cards */}
      {hotlists.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-lg">
          <p className="font-display text-lg text-ink mb-2">
            No hotlists yet
          </p>
          <p className="text-sm font-body text-muted mb-6">
            Create your first Hotlist to start comparing books
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 bg-fire text-white text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors"
          >
            + Create New Hotlist
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {hotlists.map((hl) => (
            <div
              key={hl.id}
              className="flex items-center justify-between px-4 py-3 bg-white border border-border rounded-lg hover:border-fire/20 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                {editingId === hl.id ? (
                  <input
                    ref={renameRef}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(hl.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => handleRename(hl.id)}
                    className="font-display font-bold text-ink text-base w-full border-b border-fire/40 bg-transparent focus:outline-none px-0 py-0"
                    autoFocus
                  />
                ) : (
                  <Link href={`/lists/${hl.shareSlug ?? hl.id}`} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <h3 className="font-display font-bold text-ink text-base truncate max-w-[280px] sm:max-w-[400px] group-hover:text-fire transition-colors">
                          {hl.name || "Untitled Hotlist"}
                        </h3>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            handleTogglePublic(hl.id, hl.isPublic);
                          }}
                          className={`shrink-0 text-xs font-mono px-2 py-0.5 rounded-full border transition-colors ${
                            hl.isPublic
                              ? "text-green-700 bg-green-50 border-green-200 hover:bg-green-100"
                              : "text-muted bg-cream border-border hover:border-fire/30"
                          }`}
                          title={hl.isPublic ? "Click to make private" : "Click to make public"}
                        >
                          {hl.isPublic ? "Public" : "Private"}
                        </button>
                      </div>
                      <p className="text-xs font-mono text-muted mt-0.5">
                        {hl.sourceCreatorHandle && (
                          <span className="text-fire/70">{hl.sourceCreatorHandle}</span>
                        )}
                        {hl.sourceCreatorHandle && " · "}
                        {hl.bookCount} {hl.bookCount === 1 ? "book" : "books"} · updated {timeAgo(hl.updatedAt)}
                      </p>
                    </div>
                    {/* Cover thumbnails — overlapping stack */}
                    {hl.coverUrls.length > 0 && (
                      <div className="hidden sm:flex shrink-0 -space-x-3">
                        {hl.coverUrls.map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt=""
                            className="w-[32px] h-[48px] rounded-sm shadow-sm border border-white object-cover"
                            style={{ zIndex: hl.coverUrls.length - i }}
                          />
                        ))}
                      </div>
                    )}
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-1 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* Rename */}
                <button
                  onClick={() => {
                    setEditingId(hl.id);
                    setEditName(hl.name);
                  }}
                  className="text-muted/70 hover:text-ink transition-colors p-1"
                  title="Rename"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 2.5l3 3M1.5 9.5l6-6 3 3-6 6H1.5v-3z" />
                  </svg>
                </button>
                {/* Copy share link */}
                <button
                  onClick={() => handleCopyLink(hl.shareSlug, hl.id)}
                  className="text-muted/70 hover:text-ink transition-colors p-1"
                  title="Copy share link"
                >
                  {copied === hl.id ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7.5l3 3 5-6" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
                      <path d="M9.5 4.5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5.5a1 1 0 001 1h1.5" />
                    </svg>
                  )}
                </button>
                {/* Delete */}
                <button
                  onClick={() => handleDelete(hl.id)}
                  disabled={deleting === hl.id}
                  className="text-muted/70 hover:text-fire transition-colors p-1"
                  title="Delete hotlist"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="3" y1="3" x2="11" y2="11" />
                    <line x1="11" y1="3" x2="3" y2="11" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
