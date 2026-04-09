export default function ValuePropCards() {
  return (
    <section className="py-8">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card
          icon="🔥"
          title="Decide"
          description="Ratings from Goodreads, Amazon, and Romance.io side by side. Spice levels from real readers. Know before you commit."
        />
        <Card
          icon="🎵"
          title="Immerse"
          description="Paste any BookTok link and we'll identify every book mentioned — with ratings, tropes, and spice already attached."
        />
        <Card
          icon="🧬"
          title="Discover"
          description="Take the Reading DNA test to find books that match your trope cravings and spice tolerance. No more guessing."
        />
      </div>
    </section>
  );
}

function Card({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <span className="text-2xl" aria-hidden="true">
        {icon}
      </span>
      <h3 className="font-display text-base font-bold text-ink mt-2">
        {title}
      </h3>
      <p className="text-sm font-body text-muted mt-1 leading-relaxed">
        {description}
      </p>
    </div>
  );
}
