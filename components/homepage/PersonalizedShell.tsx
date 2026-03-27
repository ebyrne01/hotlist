"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import UserHotlistBar from "@/components/home/UserHotlistBar";
import ForYouRow from "@/components/home/ForYouRow";
import DnaCtaBanner from "@/components/home/DnaCtaBanner";
import type { BookDetail } from "@/lib/types";

interface PersonalizedState {
  loading: boolean;
  userId: string | null;
  hotlists: { id: string; name: string; shareSlug: string | null; bookCount: number }[];
  forYouBooks: BookDetail[];
  hasDna: boolean;
}

export default function PersonalizedShell() {
  const [state, setState] = useState<PersonalizedState>({
    loading: true,
    userId: null,
    hotlists: [],
    forYouBooks: [],
    hasDna: false,
  });

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setState((s) => ({ ...s, loading: false }));
        return;
      }

      // Fetch hotlists and for-you data in parallel
      const [hotlistsRes, forYouRes] = await Promise.all([
        fetch("/api/homepage/hotlists"),
        fetch("/api/homepage/for-you"),
      ]);

      const hotlists = hotlistsRes.ok ? await hotlistsRes.json() : [];
      const forYouData = forYouRes.ok
        ? await forYouRes.json()
        : { books: [], hasDna: false };

      setState({
        loading: false,
        userId: user.id,
        hotlists,
        forYouBooks: forYouData.books,
        hasDna: forYouData.hasDna,
      });
    }
    load();
  }, []);

  if (state.loading || !state.userId) return null;

  return (
    <>
      <UserHotlistBar hotlists={state.hotlists} />
      <div className="max-w-6xl mx-auto px-4">
        {state.hasDna && state.forYouBooks.length > 0 && (
          <ForYouRow books={state.forYouBooks} />
        )}
        {!state.hasDna && <DnaCtaBanner />}
      </div>
    </>
  );
}
