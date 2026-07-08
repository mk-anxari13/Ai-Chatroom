import { NextResponse } from "next/server";

/**
 * Generates a concise chat thread title from the first user message.
 * Strategy: tries LLM first; if the model is rate-limited or fails,
 * falls back to extracting the first 5 meaningful words from the message.
 */
export async function POST(request: Request) {
  try {
    const { message, model } = await request.json() as {
      message: string;
      model?: string;
    };

    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    // --- Smart fallback: derive title from the message text ---
    const fallbackTitle = deriveTitle(message);

    // Attempt LLM title generation only if we have a model
    if (model) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
            "X-Title": "AI Chatroom",
          },
          body: JSON.stringify({
            model,
            stream: false,
            max_tokens: 10,
            temperature: 0,
            messages: [
              {
                role: "user",
                content: `Write a 2-4 word title for this chat: "${message}". Reply with ONLY the title words, nothing else.`,
              },
            ],
          }),
        });

        if (res.ok) {
          const data = await res.json() as {
            choices?: { message?: { content?: string } }[];
          };

          const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
          // Take first line only; strip quotes; cap at 40 chars
          const firstLine = raw.split(/\n/)[0]?.trim() ?? "";
          const cleaned = firstLine.replace(/^["""'']+|["""'']+$/g, "").trim();

          // Accept only if it's genuinely short (≤5 words) and looks like a title, not a sentence
          const wordCount = cleaned.split(/\s+/).length;
          if (cleaned.length > 2 && wordCount <= 5) {
            const title = cleaned.length > 40 ? cleaned.slice(0, 40).trimEnd() + "…" : cleaned;
            return NextResponse.json({ title });
          }
        }
      } catch {
        // LLM failed — fall through to text-derived title
      }
    }

    // Always return a meaningful title derived from the message
    return NextResponse.json({ title: fallbackTitle });
  } catch (err) {
    console.error("[/api/title] Unexpected error:", err);
    return NextResponse.json({ title: "New chat" });
  }
}

/**
 * Derives a readable title by taking the first 5-6 meaningful words
 * from the user's message and capitalizing the first letter.
 */
function deriveTitle(message: string): string {
  // Strip markdown, code fences, and excess whitespace
  const cleaned = message
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/[#*_~[\]()]/g, "")
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "New chat";

  // Take first 6 words max, cap to 40 chars
  const taken = words.slice(0, 6).join(" ");
  const capped = taken.length > 40 ? taken.slice(0, 40).trimEnd() + "…" : taken;

  // Capitalize first letter
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}
