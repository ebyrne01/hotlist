import Link from "next/link";

interface Mention {
  creatorHandle: string;
  platform: string;
  sentiment: string | null;
  quote: string | null;
}

const SENTIMENT_LABELS: Record<string, string> = {
  loved: "loved it",
  liked: "liked it",
  mixed: "mixed feelings",
  disliked: "didn't love it",
  neutral: "mentioned",
};

export default function BookTokMentions({ mentions }: { mentions: Mention[] }) {
  if (mentions.length === 0) return null;

  return (
    <section>
      <h2 className="font-display text-lg font-bold text-ink mb-3">
        📹 Seen on BookTok
      </h2>
      <div className="space-y-3">
        {mentions.slice(0, 5).map((m, i) => (
          <div key={i} className="flex gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/discover/${encodeURIComponent(m.creatorHandle)}`}
                  className="text-sm font-mono text-ink font-semibold hover:text-fire transition-colors"
                >
                  {m.creatorHandle}
                </Link>
                <span className="text-xs font-mono text-muted/70">
                  {m.platform}
                </span>
                {m.sentiment && (
                  <span className="text-xs font-mono text-muted/70">
                    · {SENTIMENT_LABELS[m.sentiment] ?? m.sentiment}
                  </span>
                )}
              </div>
              {m.quote && (
                <p className="text-xs font-body text-muted/70 italic mt-0.5 line-clamp-2">
                  &ldquo;{m.quote}&rdquo;
                </p>
              )}
              <Link
                href={`/discover/${encodeURIComponent(m.creatorHandle)}`}
                className="text-xs font-mono text-fire hover:text-fire/80 transition-colors mt-1 inline-block"
              >
                See all picks &rarr;
              </Link>
            </div>
          </div>
        ))}
      </div>
      {mentions.length > 5 && (
        <p className="text-xs font-mono text-muted/70 mt-2">
          and {mentions.length - 5} more creator{mentions.length - 5 > 1 ? "s" : ""}
        </p>
      )}
    </section>
  );
}
