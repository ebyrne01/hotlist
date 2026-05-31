import Link from "next/link";
import HotlistMark from "@/components/ui/HotlistMark";

export default function Footer() {
  return (
    <footer className="surface-night text-cream/70 mt-auto border-t border-aged-gold/30">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-6">
          {/* Wordmark */}
          <div className="text-center sm:text-left">
            <span className="inline-flex items-center gap-2 text-cream">
              <HotlistMark className="h-8 w-8 text-aged-gold [--mark-cutout:#12080a]" />
              <span className="font-display text-xl font-bold tracking-[-0.02em]">
                Hotlist
              </span>
            </span>
            <p className="text-xs font-mono text-aged-gold/80 mt-2">
              Your next great read, already waiting.
            </p>
          </div>

          {/* Links */}
          <nav className="flex gap-6 text-sm font-body">
            <Link href="/about" className="hover:text-cream transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fire rounded">
              About
            </Link>
            <Link href="/privacy" className="hover:text-cream transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fire rounded">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-cream transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fire rounded">
              Terms
            </Link>
          </nav>
        </div>

        <div className="mt-8 pt-4 border-t border-aged-gold/20 text-center">
          <p className="text-xs font-mono text-cream/50">
            &copy; {new Date().getFullYear()} Hotlist. Made for romance readers.
          </p>
        </div>
      </div>
    </footer>
  );
}
