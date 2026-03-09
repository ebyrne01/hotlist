import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = createClient();
    const { count, error } = await supabase
      .from("tropes")
      .select("*", { count: "exact", head: true });

    if (error) {
      return NextResponse.json(
        { status: "error", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ status: "ok", tropes: count });
  } catch {
    return NextResponse.json(
      { status: "error", message: "Could not connect to database" },
      { status: 500 }
    );
  }
}
