export default function BookLoading() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Cover placeholder */}
        <div className="flex-shrink-0 w-[200px] h-[300px] bg-ink/5 rounded-lg animate-pulse mx-auto md:mx-0" />

        {/* Details placeholder */}
        <div className="flex-1 space-y-4">
          <div className="h-8 w-3/4 bg-ink/10 rounded animate-pulse" />
          <div className="h-5 w-1/3 bg-ink/5 rounded animate-pulse" />

          {/* Ratings row */}
          <div className="flex gap-3 mt-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 w-20 bg-ink/5 rounded animate-pulse" />
            ))}
          </div>

          {/* Spice */}
          <div className="h-6 w-24 bg-ink/5 rounded animate-pulse mt-4" />

          {/* Synopsis */}
          <div className="space-y-2 mt-6">
            <div className="h-4 w-full bg-ink/5 rounded animate-pulse" />
            <div className="h-4 w-full bg-ink/5 rounded animate-pulse" />
            <div className="h-4 w-5/6 bg-ink/5 rounded animate-pulse" />
            <div className="h-4 w-3/4 bg-ink/5 rounded animate-pulse" />
          </div>

          {/* Tropes */}
          <div className="flex gap-2 mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-7 w-24 bg-ink/5 rounded-full animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
