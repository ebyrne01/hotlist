export default function ValuePropCards() {
  return (
    <section className="relative my-4 overflow-hidden surface-night px-5 py-10 text-cream sm:px-10 sm:py-12">
      <div className="absolute inset-0 surface-night-stars opacity-30" />
      <div className="relative grid gap-8 sm:grid-cols-[1.05fr_1.4fr] sm:items-center">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-aged-gold">
            Your shelf, with instincts
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold leading-tight sm:text-4xl">
            Read for the feeling.
            <span className="block text-fire">Choose with receipts.</span>
          </h2>
        </div>
        <div className="grid gap-5 border-l border-aged-gold/30 pl-5 sm:grid-cols-3 sm:gap-6 sm:pl-8">
          <Point number="01" title="Compare" description="Ratings, heat, and tropes in one glance." />
          <Point number="02" title="Capture" description="Turn a BookTok into a ready-made shelf." />
          <Point number="03" title="Discover" description="Build a reading DNA that knows your cravings." />
        </div>
      </div>
    </section>
  );
}

function Point({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <span className="font-mono text-[10px] tracking-[0.18em] text-aged-gold">
        {number}
      </span>
      <h3 className="mt-1 font-display text-lg font-bold text-cream">
        {title}
      </h3>
      <p className="mt-1 text-xs font-body text-cream/65 leading-relaxed">
        {description}
      </p>
    </div>
  );
}
