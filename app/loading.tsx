export default function HomeLoading() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      {/* Hero placeholder */}
      <div className="h-40 bg-ink/5 rounded-xl animate-pulse mb-10" />

      {/* Row 1 placeholder */}
      <div className="mb-8">
        <div className="h-5 w-32 bg-ink/10 rounded animate-pulse mb-4" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[140px] h-[210px] bg-ink/5 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>

      {/* Row 2 placeholder */}
      <div className="mb-8">
        <div className="h-5 w-40 bg-ink/10 rounded animate-pulse mb-4" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[140px] h-[210px] bg-ink/5 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
