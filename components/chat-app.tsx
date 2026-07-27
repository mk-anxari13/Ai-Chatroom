"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Trash2,
  LogOut,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUp,
  Copy,
  Check,
  ChevronDown,
  Wrench,
  MoreHorizontal,
  Pencil,
  Search
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import type { ChatMessage, ChatThread, ModelOption } from "@/types";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface ChatSDKMessage extends UIMessage {
  createdAt?: Date;
}

interface ExtractedToolInvocation {
  toolCallId: string;
  toolName: string;
  state: "call" | "result";
  input?: unknown;
  result?: unknown;
}

function getMessageContent(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function getToolInvocations(message: UIMessage): ExtractedToolInvocation[] {
  const list: ExtractedToolInvocation[] = [];
  for (const part of message.parts) {
    if (part.type === "dynamic-tool") {
      list.push({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        state: part.state === "output-available" ? "result" : "call",
        input: part.input,
        result: part.output,
      });
    } else if (part.type.startsWith("tool-")) {
      const toolName = part.type.replace("tool-", "");
      const call = part as unknown as { toolCallId: string; state?: string; input?: unknown; output?: unknown };
      list.push({
        toolCallId: call.toolCallId,
        toolName,
        state: call.state === "output-available" ? "result" : "call",
        input: call.input,
        result: call.output,
      });
    }
  }
  return list;
}

// Premium CodeBlock with click-to-copy capability
function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy code", e);
    }
  };

  return (
    <div className="relative my-4 rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 text-zinc-100 font-mono text-[13px] shadow-lg">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400 select-none">
        <span>{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto p-4 leading-relaxed">
        <code className={`language-${language}`}>{value}</code>
      </div>
    </div>
  );
}
export function ChatApp() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [renameThreadId, setRenameThreadId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteConfirmThreadId, setDeleteConfirmThreadId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [messageMatchedThreadIds, setMessageMatchedThreadIds] = useState<Set<string>>(new Set());

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const query = searchQuery.toLowerCase();
    return threads.filter((t) =>
      t.title.toLowerCase().includes(query) ||
      messageMatchedThreadIds.has(t.id)
    );
  }, [threads, searchQuery, messageMatchedThreadIds]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setMessageMatchedThreadIds(new Set());
        return;
      }
      try {
        const { data, error } = await supabase
          .from("messages")
          .select("thread_id")
          .ilike("content", `%${searchQuery}%`);

        if (!error && data) {
          const matchedIds = new Set<string>(data.map((m: { thread_id: string }) => m.thread_id));
          setMessageMatchedThreadIds(matchedIds);
        }
      } catch (e) {
        console.error("Search error", e);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, supabase]);

  const [enabledTools, setEnabledTools] = useState<Record<string, boolean>>({
    calculator: true,
    time: true,
    uuid: true,
    random: true,
    stats: true,
  });

  const [mounted, setMounted] = useState(false);
  const activeThreadIdRef = useRef<string | null>(null);
  const threadsRef = useRef<ChatThread[]>([]);
  const messageTextRef = useRef("");
  const pendingUserMessageRef = useRef<{
    id: string;
    role: "user";
    content: string;
    model: string;
    localThreadId: string;
  } | null>(null);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    body: {
      threadId: activeThreadId,
      model: selectedModel,
      enabledTools,
    }
  }), [activeThreadId, selectedModel, enabledTools]);

  const { messages, sendMessage, setMessages, status } = useChat<ChatSDKMessage>({
    transport,
    onFinish: async ({ message }) => {
      const dbContent = getMessageContent(message);
      const assistantDbId = crypto.randomUUID();

      const pendingUser = pendingUserMessageRef.current;
      if (pendingUser && pendingUser.localThreadId.startsWith("local-")) {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;

        // 1. Create the thread in Supabase
        const { data: createdThread, error: threadError } = await supabase
          .from("chat_threads")
          .insert({ user_id: userData.user.id, title: "New chat" })
          .select()
          .single();

        if (threadError || !createdThread) {
          setStatusMessage(`Could not create chat: ${threadError?.message ?? "unknown error"}`);
          return;
        }

        const realThreadId = createdThread.id;

        // 2. Save the User Message
        await supabase.from("messages").insert({
          id: pendingUser.id,
          thread_id: realThreadId,
          role: "user",
          content: pendingUser.content,
          model: pendingUser.model,
        });

        // 3. Save the Assistant Message
        await supabase.from("messages").insert({
          id: assistantDbId,
          thread_id: realThreadId,
          role: "assistant",
          content: dbContent,
          model: selectedModel,
        });

        // 4. Prepend the newly-created thread to the sidebar.
        // We never added a local placeholder, so just prepend the real DB thread.
        setThreads((prev) => [createdThread as ChatThread, ...prev]);

        // 5. Update activeThreadId to real ID if local thread is still active
        if (activeThreadIdRef.current === pendingUser.localThreadId) {
          setActiveThreadId(realThreadId);
        }

        // 6. Reset pending ref
        pendingUserMessageRef.current = null;

        // 7. Auto-generate thread title
        const needsTitle = !createdThread.title || createdThread.title === "New chat";
        if (needsTitle) {
          try {
            const titleRes = await fetch("/api/title", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: pendingUser.content, model: selectedModel }),
            });
            const { title } = (await titleRes.json()) as { title: string };
            if (title && title !== "New chat") {
              await supabase
                .from("chat_threads")
                .update({ title })
                .eq("id", realThreadId);
              setThreads((prev) =>
                prev.map((t) => (t.id === realThreadId ? { ...t, title } : t))
              );
            }
          } catch {
            // ignore title generation errors
          }
        }
      } else {
        // Normal thread assistant message insert
        await supabase.from("messages").insert({
          id: assistantDbId,
          thread_id: activeThreadIdRef.current,
          role: "assistant",
          content: dbContent,
          model: selectedModel,
        });

        // Auto-generate a thread title: check if the thread still has the default title
        const currentThread = threadsRef.current.find((t) => t.id === activeThreadIdRef.current);
        const needsTitle = !currentThread?.title || currentThread.title === "New chat";
        if (needsTitle) {
          try {
            const titleRes = await fetch("/api/title", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: messageTextRef.current, model: selectedModel }),
            });
            const { title } = (await titleRes.json()) as { title: string };
            if (title && title !== "New chat") {
              await supabase
                .from("chat_threads")
                .update({ title })
                .eq("id", activeThreadIdRef.current);
              setThreads((prev) =>
                prev.map((t) => (t.id === activeThreadIdRef.current ? { ...t, title } : t))
              );
            }
          } catch {
            // ignore title generation errors
          }
        }
      }

      // Sync local messages state message ID with the valid database assistant message UUID
      setMessages((prev) =>
        prev.map((msg) => (msg.id === message.id ? { ...msg, id: assistantDbId } : msg))
      );
    },
    onError: (error) => {
      setStatusMessage(`⚠️ Failed to stream response: ${error.message}`);
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  const messagesRef = useRef<ChatSDKMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const TOOL_DISPLAY: Record<string, string> = {
    calculator: "🔧 Using Calculator...",
    time: "🕒 Getting Current Time...",
    random: "🎲 Generating Random Number...",
    uuid: "🆔 Generating UUID...",
    stats: "📊 Counting Words...",
    weather: "🌤️ Fetching Weather Data...",
    currency: "💱 Converting Currency...",
  };

  const lastMessage = messages[messages.length - 1];
  const lastMessageContent = lastMessage ? getMessageContent(lastMessage) : "";
  const lastMessageToolInvocations = lastMessage ? getToolInvocations(lastMessage) : [];
  const toolCall = lastMessageToolInvocations[0];

  const toolStatus = (isLoading && toolCall)
    ? (TOOL_DISPLAY[toolCall.toolName] ?? `Using ${toolCall.toolName}...`)
    : null;

  const isAssistantReasoning = isLoading && lastMessage?.role === "assistant" && (
    lastMessage.parts.some((part) => part.type === "reasoning" && part.state !== "done") ||
    (lastMessage.parts.some((part) => part.type === "reasoning") && !lastMessageContent) ||
    (!lastMessageContent && !toolCall)
  );

  const thinking = ((isLoading && status === "submitted") || isAssistantReasoning) && !toolStatus;
  const connectingToStream = isLoading && !thinking && !toolStatus && !lastMessageContent;

  const suggestions = [
    { label: "Calculate statistics", icon: "📊", text: "Calculate statistics for [12, 15, 18, 22, 30]" },
    { label: "Check the weather", icon: "🌤️", text: "What is the weather in Tokyo?" },
    { label: "Solve math", icon: "🔧", text: "Calculate 15% of $850" },
    { label: "Convert currency", icon: "💱", text: "Convert 150 EUR to USD" }
  ];

  async function loadMessages(threadId: string) {
    if (threadId.startsWith("local-")) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (activeThreadIdRef.current === threadId) {
      if (!error && data) {
        const sdkMessages: ChatSDKMessage[] = (data as ChatMessage[]).map((m) => {
          let textContent = m.content;
          if (m.content.startsWith("[JSON_PARTS]:")) {
            try {
              const parts = JSON.parse(m.content.substring(13));
              textContent = parts
                .map((part: any) => (part.type === "text" ? part.text : ""))
                .join("");
            } catch {
              // ignore
            }
          }
          return {
            id: m.id,
            role: m.role as "user" | "assistant",
            parts: [{ type: "text" as const, text: textContent }],
            createdAt: new Date(m.created_at),
          };
        });
        setMessages(sdkMessages);
      }
      setLoadingMessages(false);
    }
  }

  async function loadThreads(userId: string) {
    const { data, error } = await supabase
      .from("chat_threads")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setThreads(data as ChatThread[]);
      if (!activeThreadId && data.length > 0) {
        const firstThreadId = data[0].id;
        setActiveThreadId(firstThreadId);
        await loadMessages(firstThreadId);
      }
    }
  }

  async function loadModels() {
    setLoadingModels(true);
    try {
      const response = await fetch("/api/models");
      const data = await response.json();
      if (data.models?.length) {
        setModels(data.models);

        const savedModel = typeof window !== "undefined" ? localStorage.getItem("selectedModel") : null;
        const exists = savedModel && data.models.some((model: ModelOption) => model.id === savedModel);

        if (exists) {
          setSelectedModel(savedModel);
        } else {
          const preferredModel = data.models.find(
            (model: ModelOption) => model.id === "nvidia/nemotron-3-super-120b-a12b:free",
          );
          setSelectedModel(preferredModel?.id ?? data.models[0].id);
        }
      }
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  }

  useEffect(() => {
    const getSession = async () => {
      if (!isSupabaseConfigured()) {
        setIsAuthenticated(false);
        setStatusMessage("Add your Supabase and OpenRouter credentials to enable authentication and chat.");
        return;
      }

      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setIsAuthenticated(false);
        setStatusMessage(null);
        router.replace("/login");
        return;
      }

      setIsAuthenticated(true);
      setUserEmail(data.user.email ?? "user@example.com");
      setStatusMessage(null);
      await loadThreads(data.user.id);
      await loadModels();
    };

    void getSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeThreadId]);

  // Handle textarea auto-resizing
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [draft]);

  function createThread() {
    // Just clear state — no thread is created until the first message is sent.
    // This matches ChatGPT behaviour: the sidebar entry only appears after the AI responds.
    setActiveThreadId(null);
    setMessages([]);
    setStatusMessage(null);
  }

  async function deleteThread(threadId: string) {
    setDeleteConfirmThreadId(threadId);
  }

  function startRename(thread: ChatThread) {
    setRenameThreadId(thread.id);
    setRenameTitle(thread.title);
  }

  async function handleRenameSubmit() {
    if (!renameThreadId || !renameTitle.trim()) return;

    const threadId = renameThreadId;
    const newTitle = renameTitle.trim();

    if (!threadId.startsWith("local-")) {
      const { error } = await supabase
        .from("chat_threads")
        .update({ title: newTitle })
        .eq("id", threadId);

      if (error) {
        setStatusMessage(`Rename failed: ${error.message}`);
        return;
      }
    }

    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, title: newTitle } : t))
    );

    setRenameThreadId(null);
    setRenameTitle("");
  }

  async function handleDeleteConfirmSubmit() {
    if (!deleteConfirmThreadId) return;
    const threadId = deleteConfirmThreadId;

    setDeleteConfirmThreadId(null);
    setThreads((prev) => prev.filter((thread) => thread.id !== threadId));

    if (activeThreadId === threadId) {
      const remainingThreads = threads.filter((thread) => thread.id !== threadId);
      if (remainingThreads[0]) {
        setActiveThreadId(remainingThreads[0].id);
        setMessages([]);
        void loadMessages(remainingThreads[0].id);
      } else {
        setActiveThreadId(null);
        setMessages([]);
      }
    }

    if (!threadId.startsWith("local-")) {
      await supabase.from("messages").delete().eq("thread_id", threadId);
      await supabase.from("chat_threads").delete().eq("id", threadId);
    }
  }

  async function handleSend() {
    if (!draft.trim() || !selectedModel || !isAuthenticated) {
      if (!isAuthenticated) {
        setStatusMessage("You need to sign in before sending a message.");
      }
      return;
    }

    const userMessage = draft.trim();
    messageTextRef.current = userMessage;
    setDraft("");
    setStatusMessage(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setStatusMessage("You need to sign in before sending a message.");
      return;
    }

    let threadId = activeThreadId;
    if (!threadId) {
      // No active thread yet — create a temporary local ID to track this new conversation.
      // The thread is NOT added to the sidebar here; it will appear only after the AI responds.
      const tempId = `local-${crypto.randomUUID()}`;
      threadId = tempId;
      setActiveThreadId(tempId);
    }

    const finalThreadId = threadId!;
    const userMessageId = crypto.randomUUID();

    if (finalThreadId.startsWith("local-")) {
      pendingUserMessageRef.current = {
        id: userMessageId,
        role: "user",
        content: userMessage,
        model: selectedModel,
        localThreadId: finalThreadId,
      };
    } else {
      pendingUserMessageRef.current = null;
      const { error: userError } = await supabase.from("messages").insert({
        id: userMessageId,
        thread_id: finalThreadId,
        role: "user",
        content: userMessage,
        model: selectedModel,
      });

      if (userError) {
        setStatusMessage(`Save failed: ${userError.message}`);
        return;
      }
    }

    // Pre-append the user message to useChat's local messages array so sendMessage is aware of it
    setMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: "user",
        parts: [{ type: "text", text: userMessage }],
        createdAt: new Date(),
      } as ChatSDKMessage,
    ]);

    try {
      await sendMessage(
        {
          text: userMessage,
          messageId: userMessageId,
        },
        {
          body: {
            threadId: finalThreadId,
            model: selectedModel,
            enabledTools,
          },
        }
      );
    } catch (e) {
      console.error(e);
      setStatusMessage("Failed to stream response");
    }
  }

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
      setIsAuthenticated(false);
      setUserEmail("");
      setThreads([]);
      setActiveThreadId(null);
      setMessages([]);
      router.replace("/login");
    } catch (e) {
      console.error("Sign out error", e);
    }
  }

  const handleSuggestionClick = (text: string) => {
    setDraft(text);
    textareaRef.current?.focus();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      {/* Sidebar: Premium Dark Theme */}
      <aside className={`hidden h-full flex-col shrink-0 bg-[#171717] text-white transition-all duration-300 lg:flex overflow-hidden ${sidebarCollapsed ? "w-[56px]" : "w-[260px]"}`}>

        {/* Logo + Collapse Button */}
        <div className={`flex items-center h-14 shrink-0 ${sidebarCollapsed ? "justify-center px-2" : "justify-between px-4"}`}>
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-sm font-semibold tracking-tight text-white truncate">Chatroom</span>
            </div>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? "Open sidebar" : "Collapse sidebar"}
            className="h-8 w-8 text-zinc-500 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        {/* New Chat Button */}
        <div className={`shrink-0 ${sidebarCollapsed ? "flex justify-center px-2 pb-3" : "px-3 pb-3"}`}>
          {sidebarCollapsed ? (
            <Tooltip content="New chat">
              <Button
                onClick={createThread}
                className="h-9 w-9 p-0 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors cursor-pointer border-0"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </Tooltip>
          ) : (
            <Button
              onClick={createThread}
              className="w-full flex items-center justify-start gap-2.5 bg-white/10 hover:bg-white/15 text-white text-sm font-medium rounded-xl px-3 py-2.5 transition-colors cursor-pointer border-0 h-auto"
            >
              <Plus className="h-4 w-4 shrink-0" />
              New chat
            </Button>
          )}
        </div>

        {/* Search */}
        {!sidebarCollapsed && (
          <div className="px-3 pb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600 pointer-events-none" />
              <input
                type="text"
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-xs bg-white/5 border border-white/10 rounded-lg text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-white/20 transition-colors"
              />
            </div>
          </div>
        )}

        {/* Thread List */}
        <ScrollArea className="flex-1 min-h-0">
          <div className={`space-y-0.5 py-1 ${sidebarCollapsed ? "px-2" : "px-2"}`}>
            {filteredThreads.map((thread) => {
              const threadContent = (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (activeThreadId !== thread.id) {
                      setActiveThreadId(thread.id);
                      setMessages([]);
                      void loadMessages(thread.id);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (activeThreadId !== thread.id) {
                        setActiveThreadId(thread.id);
                        setMessages([]);
                        void loadMessages(thread.id);
                      }
                    }
                  }}
                  className={`group flex items-center ${sidebarCollapsed ? "justify-center p-2" : "justify-between px-3 py-2"} rounded-lg transition-all duration-150 cursor-pointer ${
                    activeThreadId === thread.id
                      ? "bg-white/10 text-white"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                  }`}
                >
                  {sidebarCollapsed ? (
                    <div className="h-6 w-6 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-[10px] font-medium text-zinc-300">
                      {thread.title?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  ) : (
                    <>
                      <p className="truncate text-[13px] leading-normal flex-1 min-w-0">{thread.title}</p>
                      <div className={`transition-opacity shrink-0 ml-1 ${
                        activeThreadId === thread.id
                          ? "opacity-100 pointer-events-auto"
                          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                      }`}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 hover:bg-white/10 text-zinc-500 hover:text-white transition-colors cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36 bg-zinc-900 border border-zinc-800 text-zinc-200">
                            <DropdownMenuItem
                              className="text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 cursor-pointer flex items-center gap-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(thread);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span>Rename</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-zinc-800" />
                            <DropdownMenuItem
                              className="text-xs text-red-400 hover:text-red-300 hover:bg-zinc-800 cursor-pointer flex items-center gap-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteThread(thread.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Delete</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </>
                  )}
                </div>
              );

              return sidebarCollapsed ? (
                <Tooltip key={thread.id} content={thread.title}>
                  {threadContent}
                </Tooltip>
              ) : (
                <div key={thread.id}>{threadContent}</div>
              );
            })}
          </div>
        </ScrollArea>

        {/* User Profile */}
        {isAuthenticated && (
          <div className={`shrink-0 border-t border-white/10 ${sidebarCollapsed ? "p-2" : "p-3"}`}>
            {sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <Tooltip content={userEmail || "user@example.com"}>
                  <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-medium text-zinc-300 cursor-default select-none">
                    {(userEmail && userEmail[0]?.toUpperCase()) ?? "U"}
                  </div>
                </Tooltip>
                <Tooltip content="Sign out">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSignOut}
                    className="h-7 w-7 text-zinc-500 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-semibold text-zinc-300 shrink-0 select-none">
                    {(userEmail && userEmail[0]?.toUpperCase()) ?? "U"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium truncate text-zinc-200 max-w-[140px]" title={userEmail}>{userEmail}</p>
                    <p className="text-[10px] text-zinc-600">Logged in</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSignOut}
                  title="Sign out"
                  className="h-7 w-7 text-zinc-500 hover:text-red-400 hover:bg-white/5 shrink-0 cursor-pointer transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Chat Area */}
      <main className="flex flex-1 flex-col h-full min-w-0 overflow-hidden bg-white relative">

        {/* Scrollable conversation viewport */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {messages.length === 0 ? (
            /* Empty / Welcome state */
            <div className="flex flex-col items-center justify-center min-h-full py-12 px-4 text-center select-none">
              <div className="h-12 w-12 rounded-2xl bg-zinc-900 text-white flex items-center justify-center shadow-lg mb-6">
                <Sparkles className="h-5 w-5" />
              </div>
              <h1 className="text-[26px] font-semibold tracking-tight text-zinc-900 mb-8">
                What can I help with?
              </h1>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-[680px] w-full mb-44">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => handleSuggestionClick(s.text)}
                    className="flex flex-col items-start text-left p-4 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 hover:shadow-sm transition-all duration-150 cursor-pointer group"
                  >
                    <span className="text-xl mb-2 group-hover:scale-110 transition-transform duration-150">{s.icon}</span>
                    <span className="font-semibold text-xs text-zinc-800 mb-0.5">{s.label}</span>
                    <span className="text-[11px] text-zinc-400 truncate w-full">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message list */
            <div className="max-w-[760px] mx-auto w-full px-4 pt-8 pb-52 space-y-6">
              {loadingMessages ? (
                <p className="text-center text-xs text-zinc-400 animate-pulse py-4">Loading messages...</p>
              ) : null}

              {messages.map((message) => {
                if (message.role !== "user" && message.role !== "assistant") return null;
                const content = getMessageContent(message);
                if (message.role === "assistant" && !content) return null;

                return (
                  <div key={message.id} className="w-full">
                    {message.role === "user" ? (
                      /* User bubble */
                      <div className="flex justify-end w-full">
                        <div className="max-w-[80%] bg-[#f4f4f4] rounded-3xl px-5 py-3 text-[15px] text-zinc-800 leading-relaxed break-words">
                          {content}
                        </div>
                      </div>
                    ) : (
                      /* Assistant message */
                      <div className="flex gap-3 w-full">
                        <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-zinc-900 text-white select-none mt-0.5">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="prose prose-sm max-w-none break-words text-[15px] leading-relaxed text-zinc-800 prose-headings:mt-5 prose-headings:mb-2 prose-headings:font-semibold prose-headings:text-zinc-900 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-blockquote:border-l-2 prose-blockquote:pl-3 prose-blockquote:text-zinc-600 prose-blockquote:not-italic prose-code:rounded-md prose-code:bg-zinc-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-[13px] prose-code:text-zinc-800 prose-pre:overflow-x-auto prose-pre:bg-zinc-950 prose-pre:text-zinc-100 prose-pre:rounded-xl prose-pre:p-0">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeHighlight]}
                              components={{
                                code({ className, children, ...props }) {
                                  const match = /language-(\w+)/.exec(className || "");
                                  const value = String(children).replace(/\n$/, "");
                                  if (match) {
                                    return <CodeBlock language={match[1]} value={value} />;
                                  }
                                  return <code className={className} {...props}>{children}</code>;
                                }
                              }}
                            >
                              {content}
                            </ReactMarkdown>
                          </div>
                          <p className="text-[11px] text-zinc-400 select-none pt-2">
                            {mounted && message.createdAt
                              ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                              : ""}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Thinking indicator — kept exactly as before */}
              {thinking ? (
                <div className="flex gap-3 w-full">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-zinc-900 text-white mt-0.5">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl bg-zinc-50 border border-zinc-200 px-4 py-2.5 text-xs text-zinc-500 animate-pulse">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                    </span>
                    <span>🧠 Thinking...</span>
                  </div>
                </div>
              ) : null}

              {/* Tool status indicator — kept exactly as before */}
              {toolStatus ? (
                <div className="flex gap-3 w-full">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-zinc-900 text-white mt-0.5">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl bg-zinc-50 border border-zinc-200 px-4 py-2.5 text-xs text-zinc-600">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span>{toolStatus}</span>
                  </div>
                </div>
              ) : null}

              {/* Connecting indicator */}
              {connectingToStream ? (
                <div className="flex gap-3 w-full">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-zinc-900 text-white mt-0.5">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl bg-zinc-50 border border-zinc-200 px-4 py-2.5 text-xs text-zinc-500 animate-pulse">
                    <span>Connecting to stream...</span>
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Floating Composer */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
          <div className="max-w-[760px] mx-auto w-full px-4 pb-4 pointer-events-auto">
            {/* Fade gradient behind composer */}
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-white via-white/95 to-transparent pointer-events-none -z-10" />

            {statusMessage && (
              <p className="text-xs text-red-500 mb-2 text-center">{statusMessage}</p>
            )}
            {loadingModels && (
              <p className="text-xs text-zinc-400 mb-1 text-center animate-pulse">Loading models...</p>
            )}

            {/* Composer card */}
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-[0_4px_24px_rgba(0,0,0,0.08)] transition-shadow focus-within:shadow-[0_4px_28px_rgba(0,0,0,0.13)]">

              {/* Row 1: Model selector + Tools dropdown */}
              <div className="flex items-center justify-between px-3 pt-2.5 pb-1 border-b border-zinc-100">

                {/* Model selector */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setModelOpen(!modelOpen)}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 transition-colors cursor-pointer select-none max-w-[220px]"
                  >
                    <span className="truncate">
                      {selectedModel
                        ? (models.find((m) => m.id === selectedModel)?.name ?? selectedModel.replace("nvidia/", "").replace(":free", ""))
                        : "Select Model"}
                    </span>
                    <ChevronDown className="h-3 w-3 text-zinc-400 shrink-0" />
                  </button>

                  {modelOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setModelOpen(false)} />
                      <div className="absolute left-0 bottom-full mb-2 w-72 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl z-50 animate-in fade-in slide-in-from-bottom-1 duration-100">
                        <div className="px-2.5 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider select-none">
                          NVIDIA Free Models
                        </div>
                        <ScrollArea className="max-h-64 min-h-0">
                          <div className="space-y-0.5">
                            {models.map((model) => (
                              <button
                                key={model.id}
                                type="button"
                                onClick={() => {
                                  setSelectedModel(model.id);
                                  localStorage.setItem("selectedModel", model.id);
                                  setModelOpen(false);
                                }}
                                className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs rounded-lg transition-colors cursor-pointer ${
                                  selectedModel === model.id
                                    ? "bg-zinc-100 text-zinc-900 font-semibold"
                                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                                }`}
                              >
                                <span className="truncate pr-2">{model.name}</span>
                                {selectedModel === model.id && <Check className="h-3.5 w-3.5 text-zinc-800 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    </>
                  )}
                </div>

                {/* Tools dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-zinc-500 hover:text-zinc-900 flex items-center gap-1.5 rounded-lg px-2.5 hover:bg-zinc-100 cursor-pointer"
                    >
                      <Wrench className="h-3.5 w-3.5" />
                      <span>Tools ({Object.values(enabledTools).filter(Boolean).length})</span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel>Enable / Disable Tools</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={enabledTools.calculator}
                      onCheckedChange={(checked) => setEnabledTools((prev) => ({ ...prev, calculator: checked }))}
                    >Calculator</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={enabledTools.time}
                      onCheckedChange={(checked) => setEnabledTools((prev) => ({ ...prev, time: checked }))}
                    >Current Time</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={enabledTools.uuid}
                      onCheckedChange={(checked) => setEnabledTools((prev) => ({ ...prev, uuid: checked }))}
                    >UUID Generator</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={enabledTools.random}
                      onCheckedChange={(checked) => setEnabledTools((prev) => ({ ...prev, random: checked }))}
                    >Random Number</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={enabledTools.stats}
                      onCheckedChange={(checked) => setEnabledTools((prev) => ({ ...prev, stats: checked }))}
                    >Text Statistics</DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Row 2: Textarea + Send button */}
              <div className="flex items-end gap-2 px-3 py-2.5">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Message Chatroom..."
                  rows={1}
                  className="flex-1 min-h-[36px] max-h-[200px] py-1.5 resize-none border-0 outline-none focus:outline-none focus:ring-0 bg-transparent text-[15px] leading-relaxed text-zinc-800 placeholder-zinc-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={isLoading || !draft.trim() || !isAuthenticated}
                  className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 transition-all duration-150 ${
                    draft.trim() && !isLoading && isAuthenticated
                      ? "bg-zinc-900 hover:bg-zinc-700 text-white cursor-pointer"
                      : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                  }`}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <p className="text-[10px] text-center text-zinc-400 select-none mt-2">
              NVIDIA free models can make mistakes. Verify important info.
            </p>
          </div>
        </div>
      </main>

      {/* Rename Dialog */}
      {renameThreadId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-semibold text-zinc-900 mb-1">Rename Chat</h3>
            <p className="text-xs text-zinc-500 mb-4">Enter a new name for this chat thread.</p>
            <input
              type="text"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder="Chat title"
              className="w-full h-10 px-3 py-2 text-sm rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 mb-5 bg-zinc-50"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRenameSubmit();
                if (e.key === "Escape") setRenameThreadId(null);
              }}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRenameThreadId(null)}
                className="h-9 px-4 text-xs font-medium rounded-xl hover:bg-zinc-100"
              >Cancel</Button>
              <Button
                size="sm"
                onClick={handleRenameSubmit}
                disabled={!renameTitle.trim()}
                className="h-9 px-4 text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 rounded-xl"
              >Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmThreadId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-semibold text-zinc-900 mb-1">Delete Chat?</h3>
            <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
              This will permanently delete this conversation and all associated messages. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteConfirmThreadId(null)}
                className="h-9 px-4 text-xs font-medium rounded-xl hover:bg-zinc-100"
              >Cancel</Button>
              <Button
                size="sm"
                onClick={handleDeleteConfirmSubmit}
                className="h-9 px-4 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-xl"
              >Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
