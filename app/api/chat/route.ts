import { NextResponse } from "next/server";
import { executeTool, type ToolName } from "@/lib/tools";

function jsonLine(obj: Record<string, unknown>): string {
  return JSON.stringify(obj) + "\n";
}

type Message = { role: string; content: string };

async function streamCompletion(
  messages: Message[],
  model: string,
  onChunk: (delta: { content?: string; reasoning?: string }, finishReason: string | null) => Promise<void>,
  onError: (msg: string) => Promise<void>
): Promise<void> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      "X-Title": "AI Chatroom",
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "Unknown error");
    await onError(`OpenRouter error ${res.status}: ${errText}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    lineBuffer += decoder.decode(value, { stream: true });
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Skip SSE comment/heartbeat lines
      if (trimmed.startsWith(":")) continue;
      // Only handle data: lines
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.replace(/^data:\s*/, "");
      if (payload === "[DONE]") return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }

      // Upstream error in stream chunk
      if (parsed.error && typeof parsed.error === "object") {
        const errObj = parsed.error as Record<string, unknown>;
        const errMsg =
          typeof errObj.message === "string" ? errObj.message : JSON.stringify(parsed.error);
        await onError(errMsg);
        return;
      }

      const choices = Array.isArray(parsed.choices)
        ? (parsed.choices as Record<string, unknown>[])
        : null;
      if (!choices?.[0]) continue;

      const delta = (choices[0].delta ?? {}) as Record<string, unknown>;
      const finishReason = choices[0].finish_reason as string | null;

      await onChunk(
        {
          content: typeof delta.content === "string" ? delta.content : undefined,
          reasoning: typeof delta.reasoning === "string" ? delta.reasoning : undefined,
        },
        finishReason
      );

      if (finishReason) return;
    }
  }
}

export async function POST(request: Request) {
  try {
    const { message, model, threadId, history } = await request.json() as {
      message: string;
      model: string;
      threadId: string;
      history?: { role: string; content: string }[];
    };

    if (!message || !model || !threadId) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    const systemPrompt = `You are a helpful assistant. If you decide a tool should be used, output a single JSON object wrapped in [[TOOL_CALL]]...[[END_TOOL_CALL]] with keys {"tool":"calculator|time|random|uuid|stats|weather|currency","input":"..."}. Do not output other text inside the delimiters.`;

    const encoder = new TextEncoder();

    const outputStream = new ReadableStream({
      async start(controller) {
        const emit = (obj: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(jsonLine(obj)));
        };

        let assistantAccum = "";  // final accumulated text for persistence
        let streamBuffer = "";    // buffer for detecting [[TOOL_CALL]] tags mid-stream
        let toolResultContext = "";  // injected tool result for follow-up call

        // Build conversation messages: system + prior history + current user message
        const conversationMessages: Message[] = [
          { role: "system", content: systemPrompt },
          ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: message },
        ];

        let errorOccurred = false;

        // --- First completion pass ---
        await streamCompletion(
          conversationMessages,
          model,
          async (delta, finishReason) => {
            // Handle reasoning tokens
            if (delta.reasoning) {
              emit({ type: "reasoning", token: delta.reasoning });
            }

            // Handle content tokens with tool call detection
            if (delta.content) {
              streamBuffer += delta.content;

              // Process the streamBuffer to look for [[TOOL_CALL]] tags
              processBuffer: while (true) {
                const toolStart = streamBuffer.indexOf("[[TOOL_CALL]]");

                if (toolStart === -1) {
                  // No [[TOOL_CALL]] found — check for partial match at end
                  const pat = "[[TOOL_CALL]]";
                  let keepLen = 0;
                  for (
                    let len = Math.min(streamBuffer.length, pat.length - 1);
                    len > 0;
                    len--
                  ) {
                    if (streamBuffer.endsWith(pat.slice(0, len))) {
                      keepLen = len;
                      break;
                    }
                  }

                  const emitText =
                    keepLen > 0 ? streamBuffer.slice(0, -keepLen) : streamBuffer;

                  if (emitText) {
                    assistantAccum += emitText;
                    emit({ type: "content", token: emitText });
                  }
                  streamBuffer = keepLen > 0 ? streamBuffer.slice(-keepLen) : "";
                  break processBuffer;
                }

                // Emit text before the tool call tag
                if (toolStart > 0) {
                  const before = streamBuffer.slice(0, toolStart);
                  assistantAccum += before;
                  emit({ type: "content", token: before });
                  streamBuffer = streamBuffer.slice(toolStart);
                }

                const toolEnd = streamBuffer.indexOf("[[END_TOOL_CALL]]");
                if (toolEnd === -1) {
                  // Haven't received the closing tag yet — wait for more stream data
                  break processBuffer;
                }

                // Extract tool call JSON
                const jsonText = streamBuffer.slice("[[TOOL_CALL]]".length, toolEnd);
                streamBuffer = streamBuffer.slice(toolEnd + "[[END_TOOL_CALL]]".length);

                let callObj: { tool: string; input: string } | null = null;
                try {
                  callObj = JSON.parse(jsonText) as { tool: string; input: string };
                } catch {
                  // Malformed tool JSON — skip
                  continue;
                }

                if (callObj?.tool) {
                  emit({ type: "tool_start", tool: callObj.tool });
                  const toolRes = await executeTool(callObj.tool as ToolName, callObj.input);
                  const toolResultText = toolRes.success
                    ? toolRes.result
                    : `Error: ${toolRes.error}`;
                  emit({ type: "tool_result", tool: callObj.tool, toolResult: toolResultText });

                  // Store tool result to inject into follow-up call
                  toolResultContext = `Tool: ${callObj.tool}\nResult: ${toolResultText}`;
                }
              }
            }

            // Flush any remaining buffer on finish
            if (finishReason && streamBuffer) {
              // If streamBuffer still has content not containing a tool tag, emit it
              if (!streamBuffer.includes("[[TOOL_CALL]]")) {
                assistantAccum += streamBuffer;
                emit({ type: "content", token: streamBuffer });
              }
              streamBuffer = "";
            }
          },
          async (errMsg) => {
            emit({ type: "error", message: errMsg });
            emit({ type: "done", reply: assistantAccum });
            controller.close();
            errorOccurred = true;
          }
        );

        if (errorOccurred) return;

        // --- If a tool was called, make a follow-up completion ---
        if (toolResultContext) {
          // Add assistant's partial text + tool result as context, then ask model to respond
          const followUpMessages: Message[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
            {
              role: "assistant",
              content: assistantAccum || "(used tool)",
            },
            {
              role: "user",
              content: `Here is the result from the tool:\n\n${toolResultContext}\n\nPlease provide a helpful, human-readable response based on this result.`,
            },
          ];

          let followUpBuffer = "";

          await streamCompletion(
            followUpMessages,
            model,
            async (delta, finishReason) => {
              if (delta.reasoning) {
                emit({ type: "reasoning", token: delta.reasoning });
              }

              if (delta.content) {
                followUpBuffer += delta.content;
                assistantAccum += delta.content;
                emit({ type: "content", token: delta.content });
              }

              if (finishReason && followUpBuffer) {
                // Already emitted token by token above
              }
            },
            async (errMsg) => {
              emit({ type: "error", message: errMsg });
              emit({ type: "done", reply: assistantAccum });
              controller.close();
              errorOccurred = true;
            }
          );

          if (errorOccurred) return;
        }

        emit({ type: "done", reply: assistantAccum });
        controller.close();
      },
    });

    return new Response(outputStream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to generate response", detail: String(err) },
      { status: 500 }
    );
  }
}
