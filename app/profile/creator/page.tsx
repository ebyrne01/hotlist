"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

interface CreatorApplication {
  id: string;
  user_id: string;
  platform: string;
  handle_url: string;
  follower_count: number;
  content_description: string;
  status: string;
  created_at: string;
}

interface CreatorSettings {
  vanity_slug: string;
  bio: string;
  tiktok_handle: string;
  instagram_handle: string;
  youtube_handle: string;
  blog_url: string;
  amazon_affiliate_tag: string;
  bookshop_affiliate_id: string;
}

export default function CreatorSettingsPage() {
  const { user, profile, isLoading } = useAuth();
  const supabase = createClient();

  // Application state
  const [application, setApplication] = useState<CreatorApplication | null>(
    null
  );
  const [applicationLoaded, setApplicationLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [applicationSuccess, setApplicationSuccess] = useState(false);

  // Application form fields
  const [platform, setPlatform] = useState("tiktok");
  const [handleUrl, setHandleUrl] = useState("");
  const [followerCount, setFollowerCount] = useState("");
  const [contentDescription, setContentDescription] = useState("");

  // Creator settings state
  const [settings, setSettings] = useState<CreatorSettings>({
    vanity_slug: "",
    bio: "",
    tiktok_handle: "",
    instagram_handle: "",
    youtube_handle: "",
    blog_url: "",
    amazon_affiliate_tag: "",
    bookshop_affiliate_id: "",
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [slugError, setSlugError] = useState("");
  const [slugChecking, setSlugChecking] = useState(false);

  const isCreator = profile?.isCreator === true;

  // Fetch existing application (non-creator)
  useEffect(() => {
    if (!user || isCreator) return;

    async function fetchApplication() {
      const { data } = await supabase
        .from("creator_applications")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();

      setApplication(data);
      setApplicationLoaded(true);
    }

    fetchApplication();
  }, [user, isCreator]);

  // Fetch creator settings (verified creator)
  useEffect(() => {
    if (!user || !isCreator) return;

    async function fetchSettings() {
      const { data } = await supabase
        .from("profiles")
        .select(
          "vanity_slug, bio, tiktok_handle, instagram_handle, youtube_handle, blog_url, amazon_affiliate_tag, bookshop_affiliate_id"
        )
        .eq("id", user!.id)
        .single();

      if (data) {
        setSettings({
          vanity_slug: data.vanity_slug ?? "",
          bio: data.bio ?? "",
          tiktok_handle: data.tiktok_handle ?? "",
          instagram_handle: data.instagram_handle ?? "",
          youtube_handle: data.youtube_handle ?? "",
          blog_url: data.blog_url ?? "",
          amazon_affiliate_tag: data.amazon_affiliate_tag ?? "",
          bookshop_affiliate_id: data.bookshop_affiliate_id ?? "",
        });
      }
      setSettingsLoaded(true);
    }

    fetchSettings();
  }, [user, isCreator]);

  // Submit application
  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    const { error } = await supabase.from("creator_applications").insert({
      user_id: user.id,
      platform,
      handle_url: handleUrl,
      follower_count: parseInt(followerCount) || 0,
      content_description: contentDescription,
      status: "pending",
    });

    if (!error) {
      setApplicationSuccess(true);
    }
    setSubmitting(false);
  }

  // Check vanity slug uniqueness
  async function checkSlugUniqueness(slug: string) {
    if (!slug || !user) return;
    setSlugChecking(true);
    setSlugError("");

    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("vanity_slug", slug)
      .neq("id", user.id)
      .maybeSingle();

    if (data) {
      setSlugError("This URL is already taken.");
    }
    setSlugChecking(false);
  }

  // Save creator settings
  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!user || slugError) return;
    setSaving(true);
    setSaveSuccess(false);

    const { error } = await supabase
      .from("profiles")
      .update({
        vanity_slug: settings.vanity_slug || null,
        bio: settings.bio || null,
        tiktok_handle: settings.tiktok_handle || null,
        instagram_handle: settings.instagram_handle || null,
        youtube_handle: settings.youtube_handle || null,
        blog_url: settings.blog_url || null,
        amazon_affiliate_tag: settings.amazon_affiliate_tag || null,
        bookshop_affiliate_id: settings.bookshop_affiliate_id || null,
      })
      .eq("id", user.id);

    if (!error) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
    setSaving(false);
  }

  function updateSetting<K extends keyof CreatorSettings>(
    key: K,
    value: CreatorSettings[K]
  ) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  // --- Not logged in ---
  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-muted font-mono text-sm mb-4">
          Sign in to access creator settings.
        </p>
        <Link
          href="/profile"
          className="text-fire font-mono text-sm hover:underline"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  // --- Verified creator: settings form ---
  if (isCreator) {
    if (!settingsLoaded) {
      return (
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      );
    }

    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="font-display text-2xl font-bold text-ink mb-1">
          Creator Settings
        </h1>
        <p className="text-sm text-muted font-body mb-8">
          Manage your public creator profile and affiliate links.
        </p>

        <form onSubmit={handleSaveSettings} className="space-y-6">
          {/* Vanity URL */}
          <div className="bg-white border border-border rounded-lg p-5">
            <label className="block font-mono text-xs uppercase tracking-wide text-muted mb-2">
              Vanity URL
            </label>
            <div className="flex items-center gap-0">
              <span className="text-sm text-muted font-mono bg-cream border border-border border-r-0 rounded-l-lg px-3 py-2">
                myhotlist.app/
              </span>
              <input
                type="text"
                value={settings.vanity_slug}
                onChange={(e) => {
                  const val = e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "");
                  updateSetting("vanity_slug", val);
                  setSlugError("");
                }}
                onBlur={() => checkSlugUniqueness(settings.vanity_slug)}
                placeholder="your-name"
                className="flex-1 text-sm font-mono border border-border rounded-r-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50"
              />
            </div>
            {slugChecking && (
              <p className="text-xs text-muted font-mono mt-1">Checking...</p>
            )}
            {slugError && (
              <p className="text-xs text-fire font-mono mt-1">{slugError}</p>
            )}
          </div>

          {/* Bio */}
          <div className="bg-white border border-border rounded-lg p-5">
            <label className="block font-mono text-xs uppercase tracking-wide text-muted mb-2">
              Bio
            </label>
            <textarea
              value={settings.bio}
              onChange={(e) => {
                if (e.target.value.length <= 280) {
                  updateSetting("bio", e.target.value);
                }
              }}
              placeholder="Tell readers about yourself..."
              rows={3}
              className="w-full text-sm font-body border border-border rounded-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50 resize-none"
            />
            <p className="text-xs text-muted font-mono text-right mt-1">
              {settings.bio.length}/280
            </p>
          </div>

          {/* Social links */}
          <div className="bg-white border border-border rounded-lg p-5 space-y-4">
            <h2 className="font-mono text-xs uppercase tracking-wide text-muted">
              Social Links
            </h2>

            <div>
              <label className="block text-xs font-mono text-muted mb-1">
                TikTok Handle
              </label>
              <input
                type="text"
                value={settings.tiktok_handle}
                onChange={(e) =>
                  updateSetting("tiktok_handle", e.target.value)
                }
                placeholder="@yourhandle"
                className="w-full text-sm font-mono border border-border rounded-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-muted mb-1">
                Instagram Handle
              </label>
              <input
                type="text"
                value={settings.instagram_handle}
                onChange={(e) =>
                  updateSetting("instagram_handle", e.target.value)
                }
                placeholder="@yourhandle"
                className="w-full text-sm font-mono border border-border rounded-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-muted mb-1">
                YouTube Handle
              </label>
              <input
                type="text"
                value={settings.youtube_handle}
                onChange={(e) =>
                  updateSetting("youtube_handle", e.target.value)
                }
                placeholder="@yourhandle"
                className="w-full text-sm font-mono border border-border rounded-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-muted mb-1">
                Blog URL
              </label>
              <input
                type="text"
                value={settings.blog_url}
                onChange={(e) => updateSetting("blog_url", e.target.value)}
                placeholder="https://yourblog.com"
                className="w-full text-sm font-mono border border-border rounded-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50"
              />
            </div>
          </div>

          {/* Affiliate settings */}
          <div className="bg-white border border-border rounded-lg p-5 space-y-4">
            <h2 className="font-mono text-xs uppercase tracking-wide text-muted">
              Affiliate Settings
            </h2>

            <div>
              <label className="block text-xs font-mono text-muted mb-1">
                Amazon Affiliate Tag
              </label>
              <input
                type="text"
                value={settings.amazon_affiliate_tag}
                onChange={(e) =>
                  updateSetting("amazon_affiliate_tag", e.target.value)
                }
                placeholder="yourname-20"
                className="w-full text-sm font-mono border border-border rounded-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50"
              />
              <p className="text-xs text-muted font-body mt-1">
                Enter your Amazon Associates tracking ID. Buy links on your
                public Hotlists will use your tag.
              </p>
            </div>

            <div>
              <label className="block text-xs font-mono text-muted mb-1">
                Bookshop.org Affiliate ID
              </label>
              <input
                type="text"
                value={settings.bookshop_affiliate_id}
                onChange={(e) =>
                  updateSetting("bookshop_affiliate_id", e.target.value)
                }
                placeholder="Optional"
                className="w-full text-sm font-mono border border-border rounded-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50"
              />
            </div>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !!slugError}
              className="px-6 py-2.5 bg-fire text-cream text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
            {saveSuccess && (
              <span className="text-sm font-mono text-fire">
                Settings saved!
              </span>
            )}
          </div>
        </form>
      </div>
    );
  }

  // --- Not a creator: application flow ---
  if (!applicationLoaded) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  // Pending application
  if (application?.status === "pending" || applicationSuccess) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="bg-white border border-border rounded-lg p-8 text-center">
          <h1 className="font-display text-2xl font-bold text-ink mb-3">
            Application Received
          </h1>
          <p className="text-sm text-muted font-body leading-relaxed max-w-md mx-auto">
            Your application is under review. We&apos;ll get back to you within
            48 hours.
          </p>
          <Link
            href="/profile"
            className="inline-block mt-6 text-fire font-mono text-sm hover:underline"
          >
            Back to profile
          </Link>
        </div>
      </div>
    );
  }

  // Application form
  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold text-ink mb-2">
          Become a Hotlist Creator
        </h1>
        <p className="text-sm text-muted font-body leading-relaxed">
          Share your book recommendations, earn affiliate revenue, and help
          readers find their next great read.
        </p>
      </div>

      <form onSubmit={handleApply}>
        <div className="bg-white border border-border rounded-lg p-5 space-y-4">
          <div>
            <label className="block font-mono text-xs uppercase tracking-wide text-muted mb-2">
              Platform
            </label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full text-sm font-mono border border-border rounded-lg px-3 py-2 text-ink bg-white focus:outline-none focus:border-fire/50"
            >
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
              <option value="blog">Blog</option>
            </select>
          </div>

          <div>
            <label className="block font-mono text-xs uppercase tracking-wide text-muted mb-2">
              Handle / URL
            </label>
            <input
              type="text"
              value={handleUrl}
              onChange={(e) => setHandleUrl(e.target.value)}
              placeholder="@yourhandle or https://..."
              required
              className="w-full text-sm font-mono border border-border rounded-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50"
            />
          </div>

          <div>
            <label className="block font-mono text-xs uppercase tracking-wide text-muted mb-2">
              Approximate Follower Count
            </label>
            <input
              type="number"
              value={followerCount}
              onChange={(e) => setFollowerCount(e.target.value)}
              placeholder="10000"
              required
              min={0}
              className="w-full text-sm font-mono border border-border rounded-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50"
            />
          </div>

          <div>
            <label className="block font-mono text-xs uppercase tracking-wide text-muted mb-2">
              Brief Description of Your Content
            </label>
            <textarea
              value={contentDescription}
              onChange={(e) => {
                if (e.target.value.length <= 500) {
                  setContentDescription(e.target.value);
                }
              }}
              placeholder="What kind of book content do you create?"
              required
              rows={4}
              className="w-full text-sm font-body border border-border rounded-lg px-3 py-2 text-ink placeholder:text-muted/50 focus:outline-none focus:border-fire/50 resize-none"
            />
            <p className="text-xs text-muted font-mono text-right mt-1">
              {contentDescription.length}/500
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 px-6 py-2.5 bg-fire text-cream text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit Application"}
        </button>
      </form>
    </div>
  );
}
