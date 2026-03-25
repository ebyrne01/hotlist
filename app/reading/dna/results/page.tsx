export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import DnaResults from "./DnaResults";

export const metadata: Metadata = {
  title: "Your Reading DNA — Hotlist",
  description: "Your personalized reading preference profile is ready.",
};

export default function ReadingDnaResultsPage() {
  return <DnaResults />;
}
