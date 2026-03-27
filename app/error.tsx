"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-2xl font-bold text-ink">
        Something went wrong
      </h1>
      <p className="mt-3 text-sm font-body text-ink/60 max-w-md">
        We hit an unexpected error. This has been logged and we&apos;re looking
        into it.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs font-mono text-ink/30">
          Error ID: {error.digest}
        </p>
      )}
      <button
        onClick={() => reset()}
        className="mt-6 px-5 py-2 bg-fire text-white text-sm font-mono rounded-md hover:bg-fire/90 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
