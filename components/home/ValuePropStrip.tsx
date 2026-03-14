import Link from "next/link";

const VALUE_PROPS = [
  {
    icon: "📊",
    title: "Every rating in one place",
    desc: "Goodreads, Amazon, and community ratings side by side",
  },
  {
    icon: "🌶️",
    title: "Know the spice before you start",
    desc: "Spice levels and trope tags on every book",
  },
  {
    icon: "🔥",
    title: "Build your Hotlist",
    desc: "Compare books side by side and decide what to read next",
  },
  {
    icon: "📹",
    title: "BookTok → Hotlist",
    desc: "Paste a video link, get every book rec automatically",
    href: "/booktok",
  },
];

export default function ValuePropStrip() {
  return (
    <section className="bg-ink/[0.03] border-y border-border/50">
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6">
          {VALUE_PROPS.map((prop) => {
            const content = (
              <div className="flex items-start gap-2">
                <span className="text-lg shrink-0 mt-0.5">{prop.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-display font-bold text-ink leading-tight">
                    {prop.title}
                  </p>
                  <p className="text-xs font-body text-muted leading-snug mt-0.5">
                    {prop.desc}
                  </p>
                </div>
              </div>
            );

            if (prop.href) {
              return (
                <Link
                  key={prop.title}
                  href={prop.href}
                  className="hover:opacity-80 transition-opacity"
                >
                  {content}
                </Link>
              );
            }

            return <div key={prop.title}>{content}</div>;
          })}
        </div>
      </div>
    </section>
  );
}
