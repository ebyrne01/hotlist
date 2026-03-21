import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Hotlist",
  description:
    "Hotlist helps romance and romantasy readers find their next great read with aggregated ratings, spice levels, and trope tags.",
};

export default function AboutPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16">
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink italic">
        About Hotlist
      </h1>

      <div className="mt-6 space-y-4 font-body text-ink/80 text-sm leading-relaxed">
        <p>
          I built Hotlist because I was tired of checking three different sites
          before deciding if a book was worth reading. Goodreads for the rating,
          Reddit for the spice level, BookTok for whether anyone was actually
          talking about it. Every time I wanted a new romance or romantasy rec, it
          felt like a research project.
        </p>

        <p>
          Hotlist puts everything in one place: ratings from Goodreads, Amazon,
          and romance.io, spice levels on a 1&ndash;5 pepper scale, trope tags so
          you can find exactly what you&rsquo;re in the mood for, and an
          AI-generated synopsis that actually tells you what the book is about.
        </p>

        <p>
          The signature feature is the <strong>Hotlist</strong> itself &mdash; a
          side-by-side comparison table where you save the books you&rsquo;re
          considering and decide what to read next. No more twenty open tabs.
        </p>

        <p>
          You can also paste a BookTok link and we&rsquo;ll pull every book
          mentioned in the video. Because the best recs shouldn&rsquo;t require
          pausing and screenshotting at 0.5x speed.
        </p>

        <p className="text-muted text-xs font-mono pt-4">
          Made with care (and a lot of romantasy) in the Pacific Northwest.
        </p>
      </div>
    </main>
  );
}
