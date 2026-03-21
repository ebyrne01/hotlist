import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Hotlist",
  description: "Privacy policy for Hotlist — how we handle your data.",
};

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16">
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink italic">
        Privacy Policy
      </h1>
      <p className="text-xs font-mono text-muted mt-2">
        Last updated: March 21, 2026
      </p>

      <div className="mt-8 space-y-6 font-body text-ink/80 text-sm leading-relaxed">
        <section>
          <h2 className="font-display text-lg font-bold text-ink mb-2">
            What we collect
          </h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Account information:</strong> Email address and display
              name when you sign up.
            </li>
            <li>
              <strong>Reading activity:</strong> Books you save to Hotlists, star
              ratings, and spice ratings you submit.
            </li>
            <li>
              <strong>Usage data:</strong> Pages visited and features used, to
              improve the product. We do not use third-party trackers.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink mb-2">
            How we use it
          </h2>
          <p>
            Your data powers your personal experience: your Hotlists, your
            ratings, and recommendations relevant to you. Aggregated,
            anonymized spice ratings from all users improve spice accuracy for
            everyone.
          </p>
          <p className="mt-2">
            We never sell your personal data. We don&rsquo;t run ads. Hotlist is
            supported by affiliate links (primarily Amazon) &mdash; when you buy
            a book through a link on Hotlist, we may earn a small commission at
            no extra cost to you.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink mb-2">
            Data storage
          </h2>
          <p>
            Your data is stored securely on Supabase (PostgreSQL) with
            row-level security policies. Passwords are handled entirely by
            Supabase Auth &mdash; we never see or store your password directly.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink mb-2">
            Your rights
          </h2>
          <p>
            You can export or delete your account data at any time. To request
            data export, account deletion, or ask any privacy-related question,
            email us at{" "}
            <a
              href="mailto:privacy@myhotlist.app"
              className="text-fire underline hover:no-underline"
            >
              privacy@myhotlist.app
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink mb-2">
            Cookies
          </h2>
          <p>
            We use essential cookies for authentication (keeping you signed in).
            We do not use marketing or tracking cookies.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink mb-2">
            Changes to this policy
          </h2>
          <p>
            If we make meaningful changes, we&rsquo;ll update this page and the
            &ldquo;last updated&rdquo; date above. For significant changes, we
            may also notify you by email.
          </p>
        </section>
      </div>
    </main>
  );
}
