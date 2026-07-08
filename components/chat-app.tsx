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
  ChevronDown
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import type { ChatMessage, ChatThread, ModelOption } from "@/types";

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);

  const suggestions = [
    { label: "Calculate statistics", icon: "📊", text: "Calculate statistics for [12, 15, 18, 22, 30]" },
    { label: "Check the weather", icon: "🌤️", text: "What is the weather in Tokyo?" },
    { label: "Solve math", icon: "🔧", text: "Calculate 15% of $850" },
    { label: "Convert currency", icon: "💱", text: "Convert 150 EUR to USD" }
  ];

  async function loadMessages(threadId: string) {
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (!error && data) {
      setMessages(data as ChatMessage[]);
    }
    setLoadingMessages(false);
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

        const preferredModel = data.models.find(
          (model: ModelOption) => model.id === "nvidia/nemotron-3-super-120b-a12b:free",
        );

        setSelectedModel(preferredModel?.id ?? data.models[0].id);
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

  async function createThread() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data, error } = await supabase
      .from("chat_threads")
      .insert({ user_id: userData.user.id, title: "New chat" })
      .select()
      .single();

    if (!error && data) {
      setThreads((prev) => [data as ChatThread, ...prev]);
      setActiveThreadId(data.id);
      setMessages([]);
      setStatusMessage(null);
      await loadThreads(userData.user.id);
    }
  }

  async function deleteThread(threadId: string) {
    await supabase.from("messages").delete().eq("thread_id", threadId);
    await supabase.from("chat_threads").delete().eq("id", threadId);
    setThreads((prev) => prev.filter((thread) => thread.id !== threadId));

    if (activeThreadId === threadId) {
      const remainingThreads = threads.filter((thread) => thread.id !== threadId);
      if (remainingThreads[0]) {
        setActiveThreadId(remainingThreads[0].id);
        await loadMessages(remainingThreads[0].id);
      } else {
        setActiveThreadId(null);
        setMessages([]);
      }
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
    const messageText = userMessage;
    setDraft("");
    setIsSending(true);
    setStatusMessage(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setStatusMessage("You need to sign in before sending a message.");
      setIsSending(false);
      return;
    }

    let threadId = activeThreadId;
    if (!threadId) {
      const { data: createdThread, error: threadError } = await supabase
        .from("chat_threads")
        .insert({ user_id: userData.user.id, title: "New chat" })
        .select()
        .single();

      if (threadError || !createdThread) {
        setStatusMessage(`Could not create chat: ${threadError?.message ?? "unknown error"}`);
        setIsSending(false);
        return;
      }

      threadId = createdThread.id;
      setActiveThreadId(createdThread.id);
      setThreads((prev) => [createdThread as ChatThread, ...prev]);
      await loadThreads(userData.user.id);
    }

    const finalThreadId = threadId!;

    const optimisticUserMessage = {
      id: crypto.randomUUID(),
      thread_id: finalThreadId,
      role: "user" as const,
      content: messageText,
      model: selectedModel,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMessage as ChatMessage]);

    const { error: userError } = await supabase.from("messages").insert({
      thread_id: finalThreadId,
      role: "user",
      content: messageText,
      model: selectedModel,
    });

    if (userError) {
      setStatusMessage(`Save failed: ${userError.message}`);
      setIsSending(false);
      return;
    }

    try {
      const assistantId = crypto.randomUUID();
      const optimisticAssistant = {
        id: assistantId,
        thread_id: finalThreadId,
        role: "assistant" as const,
        content: "",
        model: selectedModel,
        created_at: new Date().toISOString(),
      } as ChatMessage;

      setMessages((prev) => [...prev, optimisticAssistant]);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageText,
          model: selectedModel,
          threadId: finalThreadId,
          // Send prior messages as conversation history (exclude the optimistic ones just added)
          history: messages
            .filter((m) => m.id !== optimisticUserMessage.id)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.body) {
        setStatusMessage("No response from server");
        setIsSending(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      const TOOL_DISPLAY: Record<string, string> = {
        calculator: "🔧 Using Calculator...",
        time: "🕒 Getting Current Time...",
        random: "🎲 Generating Random Number...",
        uuid: "🆔 Generating UUID...",
        stats: "📊 Calculating Statistics...",
        weather: "🌤️ Fetching Weather Data...",
        currency: "💱 Converting Currency...",
      };

      let finished = false;
      while (true) {
        const { done, value } = await reader.read();
        buf += decoder.decode(value || new Uint8Array(), { stream: !done });

        const parts = buf.split(/\n+/);
        buf = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.trim()) continue;
          try {
            const obj = JSON.parse(part);
            if (obj.type === "reasoning" && typeof obj.token === "string") {
              setThinking(true);
            } else if (obj.type === "content" && typeof obj.token === "string") {
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: (m.content ?? "") + obj.token } : m)));
              setThinking(false);
            } else if (obj.type === "tool_start") {
              setToolStatus(TOOL_DISPLAY[obj.tool] ?? `Using ${obj.tool}...`);
            } else if (obj.type === "tool_result") {
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: (m.content ?? "") + `\n\n[Tool result]\n${obj.toolResult}` } : m)));
              setToolStatus(null);
            } else if (obj.type === "error" && typeof obj.message === "string") {
              // Backend detected an upstream error (e.g. rate limit, provider unavailable)
              const errMsg = obj.message;
              setStatusMessage(`⚠️ ${errMsg}`);
              setToolStatus(null);
              setThinking(false);
              setIsSending(false);
              // Remove empty optimistic assistant bubble if nothing was streamed yet
              setMessages((prev) => {
                const assistantMsg = prev.find((m) => m.id === assistantId);
                if (assistantMsg && !assistantMsg.content) {
                  return prev.filter((m) => m.id !== assistantId);
                }
                return prev;
              });
              finished = true;
              break;
            } else if (obj.type === "done") {
              const finalText = obj.reply ?? "";
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: finalText, created_at: new Date().toISOString() } : m)));
              setToolStatus(null);
              setThinking(false);
              setIsSending(false);

              try {
                const { error: insertErr } = await supabase.from("messages").insert({ thread_id: finalThreadId, role: "assistant", content: finalText, model: selectedModel });
                if (!insertErr) {
                  await loadMessages(finalThreadId);

                  // Auto-generate a thread title: check if the thread still has the default title
                  const currentThread = threads.find((t) => t.id === finalThreadId);
                  const needsTitle = !currentThread?.title || currentThread.title === "New chat";
                  if (needsTitle) {
                    try {
                      const titleRes = await fetch("/api/title", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ message: messageText, model: selectedModel }),
                      });
                      const { title } = await titleRes.json() as { title: string };
                      if (title && title !== "New chat") {
                        await supabase
                          .from("chat_threads")
                          .update({ title })
                          .eq("id", finalThreadId);
                        setThreads((prev) =>
                          prev.map((t) => (t.id === finalThreadId ? { ...t, title } : t))
                        );
                      }
                    } catch {
                      // Title generation is non-critical — ignore errors
                    }
                  }
                }
              } catch {
                // ignore persistence errors
              }

              finished = true;
              break;
            }
          } catch {
            // ignore parse errors
          }
        }
        if (finished) break;

        if (done) {
          if (buf.trim()) {
            try {
              const obj = JSON.parse(buf);
              if (obj.type === "done") {
                const finalText = obj.reply ?? "";
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: finalText, created_at: new Date().toISOString() } : m)));
                setToolStatus(null);
                setThinking(false);
                setIsSending(false);
                try {
                  const { error: insertErr } = await supabase.from("messages").insert({ thread_id: finalThreadId, role: "assistant", content: finalText, model: selectedModel });
                  if (!insertErr) await loadMessages(finalThreadId);
                } catch {}
              }
            } catch {}
          }
          break;
        }
      }
    } catch {
      setStatusMessage("Failed to stream response");
    } finally {
      setIsSending(false);
      setToolStatus(null);
      setThinking(false);
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
      <aside className={`hidden h-full flex-col shrink-0 bg-zinc-950 border-r border-zinc-900 text-zinc-100 transition-all duration-200 lg:flex overflow-hidden ${sidebarCollapsed ? "w-16 p-2" : "w-[260px] p-4"}`}>
        <div className="flex items-center justify-between w-full">
          {!sidebarCollapsed && (
            <div className="min-w-0 px-2 py-1">
              <p className="text-base font-bold tracking-tight text-zinc-100 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Chatroom
              </p>
            </div>
          )}
          <div className={sidebarCollapsed ? "mx-auto" : ""}>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setSidebarCollapsed((v) => !v)}
              aria-label={sidebarCollapsed ? "Open sidebar" : "Collapse sidebar"}
              className="h-8 w-8 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className={`mt-4 ${sidebarCollapsed ? "flex justify-center" : "px-1"}`}>
          {sidebarCollapsed ? (
            <Tooltip content="New chat">
              <Button
                className="w-10 h-10 p-0 flex items-center justify-center bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 rounded-lg transition-colors cursor-pointer"
                onClick={createThread}
                title="New chat"
              >
                <Plus className="h-4.5 w-4.5" />
              </Button>
            </Tooltip>
          ) : (
            <Button
              className="w-full flex items-center justify-center bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 rounded-lg py-2.5 transition-colors cursor-pointer text-xs font-semibold"
              onClick={createThread}
              title="New chat"
            >
              <Plus className="h-4 w-2.5 mr-2" />
              New chat
            </Button>
          )}
        </div>

        <Separator className="my-4 border-zinc-800" />

        <ScrollArea className="flex-1 mt-1 min-h-0">
          <div className="space-y-1 px-1">
            {threads.map((thread) => {
              const threadContent = (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveThreadId(thread.id);
                    void loadMessages(thread.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveThreadId(thread.id);
                      void loadMessages(thread.id);
                    }
                  }}
                  className={`group flex items-center ${sidebarCollapsed ? "justify-center p-2" : "justify-between px-3 py-2"} rounded-lg transition-all duration-150 cursor-pointer ${
                    activeThreadId === thread.id
                      ? "bg-zinc-800 text-zinc-100 font-medium"
                      : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 w-full">
                    <Avatar className="h-6 w-6 shrink-0 bg-zinc-800 border border-zinc-700/60">
                      <AvatarFallback className="text-[10px] text-zinc-300">
                        {thread.title?.[0]?.toUpperCase() ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                    {!sidebarCollapsed && (
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs leading-normal">{thread.title}</p>
                      </div>
                    )}
                  </div>

                  {!sidebarCollapsed && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteThread(thread.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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

        {isAuthenticated && (
          <>
            <Separator className="my-4 border-zinc-800" />
            {sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-3 pb-1">
                <Tooltip content={userEmail || "user@example.com"}>
                  <Avatar className="h-7 w-7 border border-zinc-700 bg-zinc-800">
                    <AvatarFallback className="text-[11px] text-zinc-300">
                      {(userEmail && userEmail[0]?.toUpperCase()) ?? "U"}
                    </AvatarFallback>
                  </Avatar>
                </Tooltip>
                <Tooltip content="Sign out">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSignOut}
                    className="h-8 w-8 text-zinc-400 hover:text-red-400 hover:bg-zinc-900 transition-colors cursor-pointer"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 min-w-0 w-full pb-1 px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="h-7 w-7 border border-zinc-700 bg-zinc-800">
                    <AvatarFallback className="text-[11px] text-zinc-300">
                      {(userEmail && userEmail[0]?.toUpperCase()) ?? "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold truncate text-zinc-200 max-w-[130px]" title={userEmail}>
                      {userEmail}
                    </p>
                    <p className="text-[9px] text-zinc-500">Logged in</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSignOut}
                  title="Sign out"
                  className="h-7 w-7 text-zinc-400 hover:text-red-400 hover:bg-zinc-900 transition-colors shrink-0 cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </>
        )}
      </aside>

      {/* Main Chat Workspace */}
      <main className="flex flex-1 flex-col h-full min-w-0 overflow-hidden bg-white">
        {/* Sticky Header with ChatGPT style Selector */}
        <header className="flex items-center justify-between border-b border-zinc-100 bg-white px-4 py-2.5 z-10 shrink-0">
          <div className="flex items-center gap-2">
            
            {/* Custom Interactive Model switcher */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelOpen(!modelOpen)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[14px] font-bold text-zinc-600 hover:bg-zinc-50 transition-all cursor-pointer select-none"
              >
                <span>
                  {selectedModel ? models.find((m) => m.id === selectedModel)?.name || selectedModel.replace("nvidia/", "").replace(":free", "") : "Select Model"}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              </button>

              {modelOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setModelOpen(false)} />
                  <div className="absolute left-0 mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg z-50 animate-in fade-in slide-in-from-top-1 duration-100">
                    <div className="px-2.5 py-1.5 text-[9px] font-bold text-zinc-400 uppercase tracking-wider select-none">
                      NVIDIA Free Models
                    </div>
                    <ScrollArea className="max-h-60 overflow-y-auto min-h-0">
                      <div className="space-y-0.5">
                        {models.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => {
                              setSelectedModel(model.id);
                              setModelOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs rounded-lg transition-colors cursor-pointer ${
                              selectedModel === model.id
                                ? "bg-zinc-50 text-zinc-900 font-bold"
                                : "text-zinc-600 hover:bg-zinc-50/80 hover:text-zinc-900"
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
          </div>

          <div className="flex items-center gap-3">
            {statusMessage && <p className="text-xs text-zinc-400">{statusMessage}</p>}
            {loadingModels && <p className="text-xs text-zinc-400 animate-pulse">Updating models...</p>}
          </div>
        </header>

        {/* Scrollable Messages viewport */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-white">
          {messages.length === 0 ? (
            /* Splash / Landing state when chat is empty */
            <div className="flex flex-col items-center justify-center min-h-full py-16 px-4 text-center select-none bg-white">
              <div className="h-11 w-11 rounded-full border border-zinc-200 bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-sm mb-6 animate-bounce">
                <Sparkles className="h-5.5 w-5.5" />
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-zinc-800 mb-8 font-sans">
                What can I help with?
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => handleSuggestionClick(s.text)}
                    className="flex flex-col items-start text-left p-4 rounded-2xl border border-zinc-200 bg-white hover:bg-zinc-50/50 active:bg-zinc-50 hover:border-zinc-300 hover:shadow-sm transition-all cursor-pointer group"
                  >
                    <span className="text-lg mb-1.5 group-hover:scale-110 transition-transform">{s.icon}</span>
                    <span className="font-bold text-xs text-zinc-800 mb-0.5">{s.label}</span>
                    <span className="text-[11px] text-zinc-400 truncate w-full">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Centered Flow for messages */
            <div className="max-w-3xl mx-auto w-full px-4 py-8 space-y-6">
              {loadingMessages ? (
                <p className="text-center text-xs text-zinc-400 animate-pulse">Loading message log...</p>
              ) : null}
              {messages.map((message) => {
                if (message.role === "assistant" && !message.content) {
                  return null;
                }
                return (
                  <div key={message.id} className="w-full">
                    {message.role === "user" ? (
                      /* User message bubble */
                      <div className="flex justify-end w-full">
                        <div className="max-w-[70%] bg-zinc-100/90 rounded-2xl px-4 py-2.5 text-[15px] text-zinc-800 leading-relaxed font-sans shadow-sm break-words">
                          <p>{message.content}</p>
                        </div>
                      </div>
                    ) : (
                      /* Assistant message container with logo */
                      <div className="flex gap-4 w-full">
                        <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 border border-zinc-200/80 bg-emerald-50 text-emerald-600 shadow-sm select-none">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="prose prose-sm max-w-none break-words text-[15px] leading-relaxed text-zinc-800 prose-headings:mt-4 prose-headings:font-bold prose-headings:text-zinc-900 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-blockquote:border-l-2 prose-blockquote:pl-3 prose-blockquote:text-zinc-700 prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-pre:overflow-x-auto prose-pre:bg-zinc-950 prose-pre:text-zinc-100">
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
                              {message.content}
                            </ReactMarkdown>
                          </div>
                          <p className="text-[10px] text-zinc-400 select-none pt-1">
                            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {thinking ? (
                <div className="flex gap-4 w-full">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 border border-zinc-200/80 bg-emerald-50 text-emerald-600 shadow-sm">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl bg-zinc-50 border border-zinc-200/50 shadow-sm px-4 py-2 text-xs text-zinc-500 animate-pulse">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                    </span>
                    <span>Analyzing...</span>
                  </div>
                </div>
              ) : null}

              {toolStatus ? (
                <div className="flex gap-4 w-full">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 border border-zinc-200/80 bg-emerald-50 text-emerald-600 shadow-sm">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl bg-zinc-50 border border-zinc-200/50 shadow-sm px-4 py-2 text-xs text-zinc-600">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span>{toolStatus}</span>
                  </div>
                </div>
              ) : null}

              {isSending && !thinking && !toolStatus ? (
                <div className="flex gap-4 w-full">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 border border-zinc-200/80 bg-emerald-50 text-emerald-600 shadow-sm">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl bg-zinc-50 border border-zinc-200/50 shadow-sm px-4 py-2 text-xs text-zinc-500 animate-pulse">
                    <span>Connecting to stream...</span>
                  </div>
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input Bar Section with gradient shadow */}
        <div className="border-t border-zinc-100 bg-white pb-4 pt-2">
          <div className="max-w-3xl mx-auto w-full px-4 flex flex-col gap-2">
            <div className="relative flex items-end w-full rounded-3xl border border-zinc-200 bg-white p-1.5 shadow-sm focus-within:border-zinc-300 focus-within:ring-1 focus-within:ring-zinc-300 transition-all">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message Chatroom..."
                rows={1}
                className="flex-1 min-h-[40px] max-h-[180px] py-2 pl-4 pr-12 resize-none border-0 outline-none focus:outline-none focus:ring-0 focus:border-0 bg-transparent text-[15px] leading-relaxed text-zinc-800 placeholder-zinc-400"
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
                disabled={isSending || !draft.trim() || !isAuthenticated}
                className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
                  draft.trim() && !isSending && isAuthenticated
                    ? "bg-zinc-900 hover:bg-zinc-800 text-white cursor-pointer"
                    : "bg-zinc-100 text-zinc-300 cursor-not-allowed"
                }`}
              >
                <ArrowUp className="h-4.5 w-4.5" />
              </Button>
            </div>
            <p className="text-[10px] text-center text-zinc-400 select-none">
              NVIDIA free models can make mistakes. Verify important info.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
