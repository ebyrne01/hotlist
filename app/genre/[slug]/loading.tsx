export default function GenreLoading() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="h-8 w-48 bg-ink/10 rounded animate-pulse mb-2" />
      <div className="h-4 w-96 bg-ink/5 rounded animate-pulse mb-8" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="h-[110px] bg-ink/5 rounded-lg animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
