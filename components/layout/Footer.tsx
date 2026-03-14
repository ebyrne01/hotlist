import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-ink text-cream/70 mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-6">
          {/* Wordmark */}
          <div>
            <span className="font-display text-lg font-bold text-cream italic">
              Hotlist
            </span>
            <span className="ml-1 text-base" aria-hidden="true">🔥</span>
            <p className="text-xs font-mono text-cream/60 mt-1">
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

        <div className="mt-8 pt-4 border-t border-cream/10 text-center">
          <p className="text-xs font-mono text-cream/50">
            &copy; {new Date().getFullYear()} Hotlist. Made with 🔥 for romance readers.
          </p>
        </div>
      </div>
    </footer>
  );
}
