import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Allow up to 120s for the long-running fetch+verify work
export const maxDuration = 120;

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const VERIFY_BATCH_SIZE = 5;
const VERIFY_TIMEOUT_MS = 8000;

interface OpenRouterModel {
  id: string;
  name: string;
  pricing?: { prompt?: string; completion?: string };
}

function isFree(model: OpenRouterModel): boolean {
  // A model is considered free if its id ends with ":free"
  // or if OpenRouter reports $0 prompt pricing
  if (model.id.endsWith(":free")) return true;
  const promptPrice = parseFloat(model.pricing?.prompt ?? "1");
  const completionPrice = parseFloat(model.pricing?.completion ?? "1");
  return promptPrice === 0 && completionPrice === 0;
}

function providerFromId(id: string): string {
  // e.g. "nvidia/llama-3.1-nemotron-70b-instruct:free" → "nvidia"
  return id.split("/")[0] ?? "unknown";
}

function displayName(model: OpenRouterModel): string {
  // Use the model's own name if provided and meaningful, else derive from id
  if (model.name && model.name.trim() && model.name !== model.id) {
    return model.name;
  }
  return model.id
    .replace(/:free$/, "")
    .split("/")
    .slice(1)
    .join("/");
}

async function verifyModel(modelId: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "AI Chatroom",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
    });

    // Accept any 2xx response — model is alive
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyBatch(models: OpenRouterModel[]): Promise<OpenRouterModel[]> {
  const verified: OpenRouterModel[] = [];
  for (let i = 0; i < models.length; i += VERIFY_BATCH_SIZE) {
    const batch = models.slice(i, i + VERIFY_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (m) => {
        const ok = await verifyModel(m.id);
        return ok ? m : null;
      })
    );
    for (const r of results) {
      if (r) verified.push(r);
    }
  }
  return verified;
}

export async function POST() {
  if (!OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 500 }
    );
  }

  try {
    // 1. Fetch all models from OpenRouter
    const listRes = await fetch(`${OPENROUTER_BASE}/models`, {
      headers: { Accept: "application/json" },
    });

    if (!listRes.ok) {
      return NextResponse.json(
        { error: `OpenRouter returned ${listRes.status}` },
        { status: 502 }
      );
    }

    const listData = await listRes.json();
    const allModels: OpenRouterModel[] = listData.data ?? [];

    // 2. Filter free models
    const freeModels = allModels.filter(isFree);

    // 3. Verify each model with a lightweight test request
    const verifiedModels = await verifyBatch(freeModels);

    // 4. Upsert into Supabase
    const supabase = await createClient();
    const now = new Date().toISOString();

    const rows = verifiedModels.map((m) => ({
      id: m.id,
      name: displayName(m),
      provider: providerFromId(m.id),
      last_verified_at: now,
    }));

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from("models")
        .upsert(rows, { onConflict: "id" });

      if (upsertError) {
        console.error("Upsert error:", upsertError);
        return NextResponse.json(
          { error: `Database upsert failed: ${upsertError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      total_free: freeModels.length,
      verified: verifiedModels.length,
      models: rows,
    });
  } catch (err) {
    console.error("POST /api/models/fetch error:", err);
    return NextResponse.json(
      { error: `Fetch failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
