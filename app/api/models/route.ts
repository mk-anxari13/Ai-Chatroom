import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch models" }, { status: response.status });
    }

    const data = await response.json();
    const models = (data.data || [])
      .filter((model: { id?: string }) => model.id?.startsWith("nvidia/") && model.id?.endsWith(":free"))
      .map((model: { id: string }) => ({
        id: model.id,
        name: model.id.replace("nvidia/", "").replace(":free", ""),
      }));

    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ error: "Unable to load models" }, { status: 500 });
  }
}
