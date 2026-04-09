import { ExternalLink, MessageCircle } from "lucide-react";

interface DiscussionLink {
  url: string;
  title: string;
  source: string;
  sourceDetail: string | null;
  commentCount: number | null;
}

/** Inline Reddit icon */
function RedditIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Reddit"
      className="text-[#FF4500] shrink-0"
    >
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-6.985 4.87-3.856 0-6.987-2.176-6.987-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

export default function DiscussionHub({ links }: { links: DiscussionLink[] }) {
  if (links.length === 0) return null;

  const display = links.slice(0, 5);

  return (
    <div>
      <h3 className="font-display text-lg font-bold text-ink mb-3">
        💬 Join the Discussion
      </h3>
      <div className="space-y-2">
        {display.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2.5 group"
          >
            <span className="mt-0.5">
              {link.source === "reddit" ? (
                <RedditIcon size={16} />
              ) : (
                <ExternalLink size={16} className="text-muted/60 shrink-0" />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-body text-ink/80 group-hover:text-fire transition-colors line-clamp-1">
                {link.title}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {link.sourceDetail && (
                  <span className="text-xs font-mono text-muted/60">
                    {link.sourceDetail}
                  </span>
                )}
                {link.commentCount != null && link.commentCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs font-mono text-muted/60">
                    <MessageCircle size={10} />
                    {link.commentCount}
                  </span>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
