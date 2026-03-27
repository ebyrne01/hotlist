import Link from "next/link";

export default function CreatorNotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-2xl font-bold text-ink">
        Creator not found
      </h1>
      <p className="mt-3 text-sm font-body text-ink/60">
        We couldn&apos;t find this creator. They may not have been discovered
        yet.
      </p>
      <Link
        href="/discover"
        className="mt-6 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
      >
        &larr; Discover creators
      </Link>
    </div>
  );
}
