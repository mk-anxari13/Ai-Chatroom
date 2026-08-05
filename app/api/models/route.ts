import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("models")
      .select("id, name, provider, last_verified_at")
      .order("name", { ascending: true });

    if (error) {
      // Table may not exist yet — return empty list gracefully
      console.warn("models table error:", error.message);
      return NextResponse.json({ models: [] });
    }

    return NextResponse.json({ models: data ?? [] });
  } catch (err) {
    console.error("GET /api/models error:", err);
    return NextResponse.json({ models: [] });
  }
}
