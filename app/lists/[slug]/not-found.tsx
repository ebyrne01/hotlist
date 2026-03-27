import Link from "next/link";

export default function ListNotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-2xl font-bold text-ink">
        List not found
      </h1>
      <p className="mt-3 text-sm font-body text-ink/60">
        This list may have been deleted or the link might be incorrect.
      </p>
      <Link
        href="/lists"
        className="mt-6 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
      >
        &larr; Create a new hotlist
      </Link>
    </div>
  );
}
