import Link from "next/link";
import { BarChart2, Flame } from "lucide-react";
import { PepperIcon } from "@/components/ui/PepperIcon";
import type { ReactNode } from "react";

const VALUE_PROPS: { icon: ReactNode; title: string; desc: string; href: string; cta: string }[] = [
  {
    icon: <BarChart2 size={20} className="text-fire" aria-hidden="true" />,
    title: "Every rating in one place",
    desc: "Goodreads, Amazon, and community ratings side by side",
    href: "/book/a-court-of-thorns-and-roses-50659467",
    cta: "See an example",
  },
  {
    icon: <PepperIcon filled size={20} />,
    title: "Know the spice before you start",
    desc: "Spice levels and trope tags on every book",
    href: "/book/a-court-of-thorns-and-roses-50659467",
    cta: "See an example",
  },
  {
    icon: <Flame size={20} className="text-fire" aria-hidden="true" />,
    title: "Build your Hotlist",
    desc: "Compare books side by side and decide what to read next",
    href: "/booktok",
    cta: "Try it",
  },
];

export default function ValuePropStrip() {
  return (
    <section className="bg-ink/[0.03] border-y border-border/50">
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6">
          {VALUE_PROPS.map((prop) => (
            <Link
              key={prop.title}
              href={prop.href}
              className="flex items-start gap-2 hover:opacity-80 transition-opacity"
            >
              <span className="shrink-0 mt-0.5">{prop.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-display font-bold text-ink leading-tight">
                  {prop.title}
                </p>
                <p className="text-xs font-body text-muted leading-snug mt-0.5">
                  {prop.desc}
                </p>
                <p className="text-xs font-mono text-fire mt-1">
                  {prop.cta} &rarr;
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
