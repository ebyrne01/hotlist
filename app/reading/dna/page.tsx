export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getAdminClient } from "@/lib/supabase/admin";
import DnaTest from "./DnaTest";

export const metadata: Metadata = {
  title: "Reading DNA Test — Hotlist",
  description:
    "Take a 60-second test to discover your romance reading preferences. Get personalized book recommendations based on your favorite subgenres, tropes, and spice level.",
};

export default async function ReadingDnaPage() {
  const supabase = getAdminClient();

  // Load all canonical tropes sorted by popularity (sort_order)
  const { data: tropeRows } = await supabase
    .from("tropes")
    .select("slug, name")
    .order("sort_order", { ascending: true });

  const tropes = (tropeRows ?? []).map((t) => ({
    slug: t.slug as string,
    name: t.name as string,
  }));

  return <DnaTest tropes={tropes} />;
}
