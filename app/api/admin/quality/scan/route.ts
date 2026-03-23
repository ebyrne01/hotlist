import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkAndFlagBook } from "@/lib/quality/rules-engine";
import { requireAdmin } from "@/lib/api/require-admin";

/**
 * POST /api/admin/quality/scan
 * Triggers a full rules-engine scan of all books. Runs in the background.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const scope = (body as { scope?: string }).scope === "unflagged" ? "unflagged" : "all";

  // Start the scan in the background — don't await
  runScan(scope).catch(err =>
    console.error("[quality scan] Fatal error:", err)
  );

  return NextResponse.json({ ok: true, message: "Scan started", scope });
}

async function runScan(scope: string) {
  const supabase = getAdminClient();
  const batchSize = 100;
  let offset = 0;
  let totalChecked = 0;
  let totalFlagged = 0;

  while (true) {
    let query = supabase
      .from("books")
      .select("id")
      .order("created_at", { ascending: false })
      .range(offset, offset + batchSize - 1);

    // If "unflagged", only scan books with no open flags
    if (scope === "unflagged") {
      // Get book IDs that have open flags
      const { data: flaggedBooks } = await supabase
        .from("quality_flags")
        .select("book_id")
        .eq("status", "open");

      const flaggedIds = (flaggedBooks || []).map((f: { book_id: string }) => f.book_id);
      if (flaggedIds.length > 0) {
        query = query.not("id", "in", `(${flaggedIds.join(",")})`);
      }
    }

    const { data: books, error } = await query;

    if (error) {
      console.error("[quality scan] Query error:", error.message);
      break;
    }

    if (!books || books.length === 0) break;

    for (const book of books) {
      const count = await checkAndFlagBook(book.id, true);
      totalFlagged += count;
      totalChecked++;
    }

    console.log(
      `[quality scan] Processed ${totalChecked} books, ${totalFlagged} flags created...`
    );

    if (books.length < batchSize) break;
    offset += batchSize;
  }

  console.log(
    `[quality scan] Complete. ${totalChecked} books checked, ${totalFlagged} flags created.`
  );
}
