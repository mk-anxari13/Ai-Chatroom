import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool, toUIMessageStream, createUIMessageStreamResponse, convertToModelMessages, isStepCount, type ToolSet, type UIMessage } from "ai";
import { executeTool } from "@/lib/tools";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/rbac";
import { searchKnowledgeBaseWithShared } from "@/lib/knowledge/retrieval";
import { z } from "zod";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    "X-Title": "AI Chatroom",
  },
});

interface PdfContext {
  filename: string;
  text: string;
  pages: number;
  truncated: boolean;
}

export async function POST(request: Request) {
  try {
    const { messages, model, threadId, enabledTools, pdfContext } = await request.json() as {
      messages: UIMessage[];
      model: string;
      threadId: string;
      enabledTools?: Record<string, boolean>;
      pdfContext?: PdfContext | null;
    };

    if (!messages || !model || !threadId) {
      return new Response("Missing parameters", { status: 400 });
    }

    // Create supabase client once for this request (used by searchChatHistory)
    const supabase = await createClient();

    const allTools = {
      calculator: tool({
        description: "Execute a mathematical calculation. Allows basic arithmetic only (+ - * / ( ) . %).",
        inputSchema: z.object({
          expression: z.string().describe("The mathematical expression to evaluate, e.g. '85 * 0.15'"),
        }),
        execute: async ({ expression }: { expression: string }) => {
          const res = await executeTool("calculator", expression);
          return res.success ? (res.result ?? "") : `Error: ${res.error ?? "Unknown error"}`;
        },
      }),
      time: tool({
        description: "Get the current time and date.",
        inputSchema: z.object({}),
        execute: async () => {
          const res = await executeTool("time");
          return res.success ? (res.result ?? "") : `Error: ${res.error ?? "Unknown error"}`;
        },
      }),
      stats: tool({
        description: "Count the words and characters in a block of text.",
        inputSchema: z.object({
          text: z.string().describe("The text block to analyze."),
        }),
        execute: async ({ text }: { text: string }) => {
          const res = await executeTool("stats", text);
          return res.success ? (res.result ?? "") : `Error: ${res.error ?? "Unknown error"}`;
        },
      }),
      weather: tool({
        description: "Retrieve simulated weather conditions for a specified location.",
        inputSchema: z.object({
          city: z.string().describe("The city name, e.g. 'Tokyo'"),
        }),
        execute: async ({ city }: { city: string }) => {
          const res = await executeTool("weather", city);
          return res.success ? (res.result ?? "") : `Error: ${res.error ?? "Unknown error"}`;
        },
      }),
      currency: tool({
        description: "Convert a monetary amount from one currency to another using simulated exchange rates.",
        inputSchema: z.object({
          amount: z.number().describe("The amount of money to convert."),
          from: z.string().describe("The 3-letter currency code to convert from, e.g. 'EUR'"),
          to: z.string().describe("The 3-letter currency code to convert to, e.g. 'USD'"),
        }),
        execute: async ({ amount, from, to }: { amount: number; from: string; to: string }) => {
          const res = await executeTool("currency", JSON.stringify({ amount, from, to }));
          return res.success ? (res.result ?? "") : `Error: ${res.error ?? "Unknown error"}`;
        },
      }),
      searchChatHistory: tool({
        description: "Search the current user's previous conversations for relevant information. Use this when the user asks about past discussions, previous questions, or wants to find something they discussed before. Searches through thread titles and message content.",
        inputSchema: z.object({
          query: z.string().describe("The search query to find in the user's past conversations."),
        }),
        execute: async ({ query }: { query: string }) => {
          try {
            // Authenticate the caller
            const { data: userData, error: authError } = await supabase.auth.getUser();
            if (authError || !userData.user) {
              return { results: [], error: "Not authenticated" };
            }

            const userId = userData.user.id;
            const searchPattern = `%${query}%`;

            // Search thread titles
            const { data: threadMatches } = await supabase
              .from("chat_threads")
              .select("id, title")
              .eq("user_id", userId)
              .ilike("title", searchPattern)
              .limit(5);

            // Search message content (both user and assistant)
            const { data: messageMatches } = await supabase
              .from("messages")
              .select("id, thread_id, role, content")
              .ilike("content", searchPattern)
              .limit(10);

            if (!messageMatches && !threadMatches) {
              return { results: [] };
            }

            // Fetch thread info for message matches
            const messageThreadIds = (messageMatches ?? []).map((m: { thread_id: string }) => m.thread_id);
            const threadTitleMatches = threadMatches?.map((t: { id: string }) => t.id) ?? [];
            const allThreadIds = [...new Set([...messageThreadIds, ...threadTitleMatches])];

            let threadMap: Record<string, { id: string; title: string; user_id: string }> = {};
            if (allThreadIds.length > 0) {
              const { data: threads } = await supabase
                .from("chat_threads")
                .select("id, title, user_id")
                .eq("user_id", userId)
                .in("id", allThreadIds);

              if (threads) {
                for (const t of threads as { id: string; title: string; user_id: string }[]) {
                  threadMap[t.id] = t;
                }
              }
            }

            // Build results — thread title matches first, then message matches
            interface SearchResult {
              threadId: string;
              threadTitle: string;
              snippet: string;
              messageId: string;
              role: "user" | "assistant" | "thread";
            }
            const results: SearchResult[] = [];
            const seenThreads = new Set<string>();

            // Thread title matches
            for (const t of (threadMatches ?? []) as { id: string; title: string }[]) {
              if (!seenThreads.has(t.id)) {
                seenThreads.add(t.id);
                results.push({
                  threadId: t.id,
                  threadTitle: t.title,
                  snippet: `Conversation titled: "${t.title}"`,
                  messageId: "",
                  role: "thread",
                });
              }
            }

            // Message matches
            for (const m of (messageMatches ?? []) as { id: string; thread_id: string; role: string; content: string }[]) {
              const thread = threadMap[m.thread_id];
              if (!thread) continue; // not owned by this user (RLS fallback)
              const snippetRaw = m.content.replace(/\[JSON_PARTS\]:.*/, "").trim();
              const snippet = snippetRaw.length > 120
                ? snippetRaw.slice(0, 120) + "…"
                : snippetRaw;

              // Deduplicate by thread if title already matched — still add message match
              results.push({
                threadId: m.thread_id,
                threadTitle: thread.title,
                snippet,
                messageId: m.id,
                role: m.role as "user" | "assistant",
              });
            }

            // Cap at 8 results
            return { results: results.slice(0, 8) };
          } catch (err) {
            console.error("searchChatHistory error:", err);
            return { results: [], error: "Search failed" };
          }
        },
      }),
      searchKnowledgeBase: tool({
        description:
          "ALWAYS use this tool first if the user asks about company policies, procedures, documentation, " +
          "or any internal topic, or if they ask a question you cannot confidently answer from general knowledge. " +
          "Search the enterprise knowledge base for relevant information from uploaded company documents. " +
          "Returns the most relevant document chunks with source metadata.",
        inputSchema: z.object({
          query: z.string().describe("The search query to find relevant information in the knowledge base."),
        }),
        execute: async ({ query }: { query: string }) => {
          try {
            // tenant_id is ALWAYS derived server-side — never from the client
            const ctx = await getTenantContext(supabase);
            if (!ctx) return { chunks: [], message: "Not authenticated" };

            // Search own KB + shared KB simultaneously
            const result = await searchKnowledgeBaseWithShared(supabase, ctx.tenantId, query, 8);

            if (result.chunks.length === 0) {
              return {
                chunks: [],
                message: "No relevant documents found in the knowledge base for this query.",
              };
            }

            return {
              chunks: result.chunks.map((c) => ({
                filename: c.filename,
                chunkIndex: c.chunk_index,
                text: c.chunk_text,
                source: c.source ?? "own",
              })),
              message: `Found ${result.chunks.length} relevant passage${result.chunks.length === 1 ? "" : "s"} (${result.chunks.filter((c) => c.source === "shared").length} from Shared KB).`,
            };
          } catch (err) {
            console.error("searchKnowledgeBase tool error:", err);
            return { chunks: [], message: "Knowledge base search failed" };
          }
        },
      }),
    };

    // Filter tools to only include toggleable tools that are enabled, plus system-default tools (weather, currency)
    const activeTools: ToolSet = {};
    const userToggleable = ["calculator", "time", "stats", "searchChatHistory", "searchKnowledgeBase"];

    for (const name of Object.keys(allTools)) {
      const toolKey = name as keyof typeof allTools;
      if (!userToggleable.includes(name)) {
        activeTools[name] = allTools[toolKey];
      } else if (enabledTools && enabledTools[name] === true) {
        activeTools[name] = allTools[toolKey];
      } else if (!enabledTools) {
        activeTools[name] = allTools[toolKey];
      }
    }

    let baseSystemPrompt = "You are a helpful assistant with access to several tools.\n\n";
    
    if (activeTools.searchKnowledgeBase) {
      baseSystemPrompt += 
        "KNOWLEDGE BASE: When the user asks about company policies, procedures, or topics that may be in " +
        "uploaded documents, ALWAYS use the searchKnowledgeBase tool. " +
        "Results may come from two sources:\n" +
        "  - The user's own tenant knowledge base (source: own)\n" +
        "  - The enterprise-wide Shared Knowledge Base (source: shared)\n" +
        "When you receive results from searchKnowledgeBase:\n" +
        "- Answer naturally and thoroughly using the retrieved content.\n" +
        "- At the end of your answer, add a 'Sources' section listing the document filenames.\n" +
        "- For shared documents, append [Shared KB] after the filename, e.g. 'Policy Guide [Shared KB]'.\n" +
        "- Example format: 'According to [Filename]:\\n\\n[answer]\\n\\nSources:\\n• [Filename]\\n• [Filename] [Shared KB]'\n" +
        "- If the tool returns no results, answer from your general knowledge and mention no relevant documents were found.\n\n";
    }

    if (activeTools.searchChatHistory) {
      baseSystemPrompt +=
        "CHAT HISTORY: When you use the searchChatHistory tool and find results, after your answer include a " +
        "section titled 'Related Conversations' that lists the found conversations with their titles and snippets.\n\n";
    }

    baseSystemPrompt += "PDF FILES: You can also analyze PDF documents that users attach — answer questions about their content thoroughly.";

    // Build system instructions: if a pdfContext was passed (fallback for models
    // that don't natively support PDF file inputs), append the extracted text.
    let systemPrompt = baseSystemPrompt;
    if (pdfContext?.text) {
      systemPrompt +=
        `\n\n--- Attached PDF: ${pdfContext.filename} (${pdfContext.pages} page${pdfContext.pages === 1 ? "" : "s"}) ---\n` +
        (pdfContext.truncated ? "(Note: text was truncated to 50,000 characters)\n" : "") +
        pdfContext.text +
        "\n--- End of PDF ---";
    }


    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: openrouter(model),
      instructions: systemPrompt,
      messages: modelMessages,
      tools: activeTools,
      stopWhen: isStepCount(5),
    });

    const uiStream = toUIMessageStream({
      stream: result.stream,
      tools: activeTools,
    });

    return createUIMessageStreamResponse({
      stream: uiStream,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to generate response", detail: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

