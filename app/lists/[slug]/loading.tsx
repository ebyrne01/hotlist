export default function ListLoading() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="h-8 w-64 bg-ink/10 rounded animate-pulse mb-2" />
      <div className="h-4 w-40 bg-ink/5 rounded animate-pulse mb-8" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 w-full bg-ink/5 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
}
