"use client";

import Link from "next/link";
import HotlistMark from "@/components/ui/HotlistMark";
import { useSignInModal, type SignInContext } from "@/lib/auth/useSignInModal";

interface SignInPromptProps {
  eyebrow?: string;
  title: string;
  body: string;
  primaryLabel?: string;
  context?: SignInContext;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export default function SignInPrompt({
  eyebrow = "Save your reading life",
  title,
  body,
  primaryLabel = "Sign in free",
  context,
  secondaryHref = "/search",
  secondaryLabel = "Keep browsing",
}: SignInPromptProps) {
  const { openSignIn } = useSignInModal();

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="mx-auto inline-flex rounded-2xl border border-aged-gold/30 bg-white p-3 text-fire shadow-sm">
        <HotlistMark className="h-10 w-10 [--mark-cutout:#fff]" />
      </div>
      <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.22em] text-fire">
        {eyebrow}
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
        {title}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm font-body leading-6 text-muted-a11y">
        {body}
      </p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <button
          onClick={() => openSignIn(null, context)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-fire px-5 py-2 text-sm font-mono text-white transition-colors hover:bg-fire/90"
        >
          {primaryLabel}
        </button>
        <Link
          href={secondaryHref}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-aged-gold/30 bg-cream px-5 py-2 text-sm font-mono text-muted-a11y transition-colors hover:border-fire/30 hover:text-fire"
        >
          {secondaryLabel}
        </Link>
      </div>
    </div>
  );
}
