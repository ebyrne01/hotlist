import Link from "next/link";

interface HotlistSummary {
  id: string;
  name: string;
  shareSlug: string | null;
  bookCount: number;
}

interface UserHotlistBarProps {
  hotlists: HotlistSummary[];
}

export default function UserHotlistBar({ hotlists }: UserHotlistBarProps) {
  if (hotlists.length === 0) return null;

  return (
    <section className="max-w-6xl mx-auto px-4 py-4">
      <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
        <span className="text-xs font-mono text-muted/70 uppercase tracking-wider shrink-0">
          Your Hotlists
        </span>
        {hotlists.slice(0, 4).map((list) => (
          <Link
            key={list.id}
            href={`/lists/${list.shareSlug ?? list.id}`}
            className="shrink-0 px-3 py-1.5 bg-white border border-border rounded-full text-xs font-mono text-ink hover:border-fire/30 hover:text-fire transition-colors truncate max-w-[200px]"
          >
            {list.name} &middot; {list.bookCount}
          </Link>
        ))}
        <Link
          href="/lists"
          className="shrink-0 text-xs font-mono text-fire hover:text-fire/80 transition-colors"
        >
          See all &rarr;
        </Link>
      </div>
    </section>
  );
}
