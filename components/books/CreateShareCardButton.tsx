"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface Props {
  bookSlug: string;
}

export default function CreateShareCardButton({ bookSlug }: Props) {
  const [isCreator, setIsCreator] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      supabase
        .from("profiles")
        .select("is_creator")
        .eq("id", data.user.id)
        .single()
        .then(({ data: profile }) => {
          if (profile?.is_creator) setIsCreator(true);
        });
    });
  }, []);

  if (!isCreator) return null;

  return (
    <Link
      href={`/creator/card/${bookSlug}`}
      className="inline-flex items-center gap-1.5 text-xs font-mono text-stone-500 hover:text-fire transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 16 16">
        <path
          d="M8 1c1.5 2.5 4 4 4 7.5a4 4 0 0 1-8 0C4 5 6.5 3.5 8 1z"
          fill="currentColor"
        />
      </svg>
      Create share card
    </Link>
  );
}
