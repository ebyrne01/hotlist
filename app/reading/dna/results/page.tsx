export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import DnaResults from "./DnaResults";

export const metadata: Metadata = {
  title: "Your Reading DNA — Hotlist",
  description: "Your Hotlist lens is ready to judge whether a romance book is your kind of hot.",
};

export default function ReadingDnaResultsPage() {
  return <DnaResults />;
}
