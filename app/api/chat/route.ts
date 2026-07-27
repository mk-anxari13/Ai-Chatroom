import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool, toUIMessageStream, createUIMessageStreamResponse, convertToModelMessages, isStepCount, type ToolSet } from "ai";
import { executeTool } from "@/lib/tools";
import { z } from "zod";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    "X-Title": "AI Chatroom",
  },
});

export async function POST(request: Request) {
  try {
    const { messages, model, threadId, enabledTools } = await request.json();

    if (!messages || !model || !threadId) {
      return new Response("Missing parameters", { status: 400 });
    }

    const systemPrompt = "You are a helpful assistant. You have access to a set of tools that you can use to answer questions.";

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
      random: tool({
        description: "Generate a random integer between a minimum and maximum value.",
        inputSchema: z.object({
          min: z.number().optional().describe("The lower bound of the random range. Defaults to 0."),
          max: z.number().optional().describe("The upper bound of the random range. Defaults to 100."),
        }),
        execute: async ({ min, max }: { min?: number; max?: number }) => {
          const res = await executeTool("random", JSON.stringify({ min, max }));
          return res.success ? (res.result ?? "") : `Error: ${res.error ?? "Unknown error"}`;
        },
      }),
      uuid: tool({
        description: "Generate a random UUID.",
        inputSchema: z.object({}),
        execute: async () => {
          const res = await executeTool("uuid");
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
    };

    // Filter tools to only include toggleable tools that are enabled, plus system-default tools (weather, currency)
    const activeTools: ToolSet = {};
    const userToggleable = ["calculator", "time", "uuid", "random", "stats"];

    for (const name of Object.keys(allTools)) {
      const toolKey = name as keyof typeof allTools;
      if (!userToggleable.includes(name)) {
        activeTools[name] = allTools[toolKey];
      } else if (!enabledTools || enabledTools[name] !== false) {
        activeTools[name] = allTools[toolKey];
      }
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
