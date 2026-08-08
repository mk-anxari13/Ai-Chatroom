"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Plus,
  Trash2,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUp,
  Copy,
  Check,
  ChevronDown,
  Wrench,
  MoreHorizontal,
  Pencil,
  Search,
  Settings,
  Paperclip,
  X as XIcon,
  FileText,
  Sparkles,
  PanelRight,
  FileInput,
  FilePlus2,
  MessageSquarePlus,
  Wand2,
  ListFilter,
  RefreshCw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
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
import { SettingsPanel } from "@/components/settings-panel";
import { PdfUpload, type PdfResult } from "@/components/pdf-upload";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import dynamic from "next/dynamic";

import type { EditorHandle } from "@/components/rich-text-editor";

// RichTextEditor is client-only (accesses window/document) — load without SSR
const RichTextEditor = dynamic(
  () => import("@/components/rich-text-editor").then((m) => ({ default: m.RichTextEditor })),
  { ssr: false }
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  threadId: string;
  threadTitle: string;
  snippet: string;
  messageId: string;
  role: "user" | "assistant" | "thread";
}

interface RelatedConversationsProps {
  results: SearchResult[];
  onNavigate: (threadId: string, messageId?: string) => void;
}

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Related Conversations (Fluent InfoCard style) ────────────────────────────

function RelatedConversations({ results, onNavigate }: RelatedConversationsProps) {
  if (!results || results.length === 0) return null;
  return (
    <div className="mt-4 pt-4 border-t border-[#E5E5E5]">
      <p className="text-[11px] font-semibold text-[#8A8A8A] uppercase tracking-wider mb-2.5 select-none">
        Related Conversations
      </p>
      <div className="space-y-2">
        {results.map((result, i) => (
          <div
            key={`${result.threadId}-${result.messageId || i}`}
            className="group flex flex-col gap-1 rounded-lg border border-[#E5E5E5] bg-[#FAFAFA] px-3.5 py-3
                       hover:border-[#C7C7C7] hover:bg-[#F3F3F3] transition-all duration-150 cursor-pointer"
            onClick={() => onNavigate(result.threadId, result.messageId || undefined)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavigate(result.threadId, result.messageId || undefined);
              }
            }}
          >
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-[#0078D4] shrink-0" />
              <span className="text-[13px] font-medium text-[#1A1A1A] truncate flex-1">
                {result.threadTitle}
              </span>
            </div>
            {result.snippet && result.role !== "thread" && (
              <p className="text-[12px] text-[#5C5C5C] leading-snug line-clamp-2 ml-5">
                &ldquo;{result.snippet}&rdquo;
              </p>
            )}
            <span className="text-[11px] text-[#0078D4] group-hover:underline font-medium ml-5 transition-colors">
              Open conversation →
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Code Block (Windows 11 dark surface) ─────────────────────────────────────

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
    <div className="relative my-4 rounded-xl overflow-hidden border border-[#3A3A3A] bg-[#1E1E1E] text-[#D4D4D4] font-mono text-[13px]"
         style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}>
      {/* Code header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#2D2D2D] border-b border-[#3A3A3A] text-[11px] text-[#8A8A8A] select-none">
        <span className="font-medium">{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 hover:text-[#D4D4D4] transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-[#4EC9B0]" />
              <span className="text-[#4EC9B0] font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
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

// ─── Windows logo SVG ─────────────────────────────────────────────────────────

function WindowsLogo({ size = 16 }: { size?: number }) {
  const s = size / 2 - 1;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="0" y="0" width={s} height={s} rx="0.5" fill="#F25022" />
      <rect x={s + 2} y="0" width={s} height={s} rx="0.5" fill="#7FBA00" />
      <rect x="0" y={s + 2} width={s} height={s} rx="0.5" fill="#00A4EF" />
      <rect x={s + 2} y={s + 2} width={s} height={s} rx="0.5" fill="#FFB900" />
    </svg>
  );
}

// ─── Fluent ProgressRing (thinking indicator) ─────────────────────────────────

function ProgressRing({ size = 16, color = "#0078D4" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: "fluent-spin 0.8s linear infinite" }}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke={color} strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M8 2 A6 6 0 0 1 14 8"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── AssistantActionBar ───────────────────────────────────────────────────────

interface AssistantActionBarProps {
  content: string;
  onInsert: () => void;
  onAppend: () => void;
  onReplace: () => void;
  onRewrite: () => void;
  onSummarize: () => void;
  onFollowUp: () => void;
}

function AssistantActionBar({ content, onInsert, onAppend, onReplace, onRewrite, onSummarize, onFollowUp }: AssistantActionBarProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  const actionBtnClass = `flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[11.5px] font-medium
    text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#EAEFF5] transition-colors cursor-pointer select-none`;

  return (
    <div className="win-action-bar flex flex-wrap items-center gap-1 mt-2 p-1 bg-[#F8FAFD] border border-[#E2E8F0] rounded-lg shadow-2xs" role="toolbar" aria-label="Response actions">
      {/* Copy */}
      <button type="button" onClick={() => void handleCopy()} className={actionBtnClass} title="Copy response">
        {copied ? <Check className="h-3.5 w-3.5 text-[#107C10]" /> : <Copy className="h-3.5 w-3.5" />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>

      <span className="w-px h-4 bg-[#D1D8E2] mx-0.5" aria-hidden />

      {/* Insert into document */}
      <button type="button" onClick={onInsert} className={actionBtnClass} title="Insert at cursor in document">
        <FileInput className="h-3.5 w-3.5 text-[#0078D4]" />
        <span>Insert</span>
      </button>

      {/* Replace selection */}
      <button type="button" onClick={onReplace} className={actionBtnClass} title="Replace selected text in document">
        <Pencil className="h-3.5 w-3.5 text-[#0078D4]" />
        <span>Replace</span>
      </button>

      {/* Append to document */}
      <button type="button" onClick={onAppend} className={actionBtnClass} title="Append to end of document">
        <FilePlus2 className="h-3.5 w-3.5 text-[#0078D4]" />
        <span>Append</span>
      </button>

      {/* Rewrite selection */}
      <button type="button" onClick={onRewrite} className={actionBtnClass} title="Rewrite selected text in document">
        <Wand2 className="h-3.5 w-3.5 text-[#7A42E2]" />
        <span>Rewrite</span>
      </button>

      {/* Summarize into document */}
      <button type="button" onClick={onSummarize} className={actionBtnClass} title="Summarize into document">
        <ListFilter className="h-3.5 w-3.5 text-[#0078D4]" />
        <span>Summarize</span>
      </button>

      <span className="w-px h-4 bg-[#D1D8E2] mx-0.5" aria-hidden />

      {/* Follow up */}
      <button type="button" onClick={onFollowUp} className={actionBtnClass} title="Ask a follow-up question">
        <MessageSquarePlus className="h-3.5 w-3.5 text-[#0078D4]" />
        <span>Follow up</span>
      </button>
    </div>
  );
}

// ─── Main ChatApp Component ────────────────────────────────────────────────────

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renameThreadId, setRenameThreadId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteConfirmThreadId, setDeleteConfirmThreadId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<"tenant_admin" | "shared_admin" | "user" | null>(null);

  // Rich Text Editor (Pages) panel state
  // Initialize to false to match server render; useEffect syncs localStorage after hydration
  const [editorOpen, setEditorOpen] = useState<boolean>(false);

  useEffect(() => {
    setEditorOpen(localStorage.getItem("rte-panel-open") === "true");
  }, []);

  function toggleEditor() {
    setEditorOpen((prev) => {
      const next = !prev;
      localStorage.setItem("rte-panel-open", String(next));
      return next;
    });
  }

  // PDF attachment state
  const [pdfContext, setPdfContext] = useState<PdfResult | null>(null);
  const [pdfUploadOpen, setPdfUploadOpen] = useState(false);
  const [composerDragFile, setComposerDragFile] = useState<File | null>(null);

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
    stats: true,
    searchChatHistory: true,
    searchKnowledgeBase: true,
  });

  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

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

  // Editor imperative handle — wired via onReady callback
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string, durationMs = 2200) => {
    setToast(msg);
    setTimeout(() => setToast(null), durationMs);
  }, []);

  // Helper: insert content into the editor (opens it first if needed)
  const editorInsert = useCallback((text: string, mode: "insert" | "append" | "replace" | "rewrite" | "summarize") => {
    if (!editorOpen) {
      setEditorOpen(true);
      localStorage.setItem("rte-panel-open", "true");
    }

    const executeAction = () => {
      if (!editorHandleRef.current) {
        showToast("Opening document workspace...");
        setTimeout(executeAction, 200);
        return;
      }
      if (mode === "insert") {
        editorHandleRef.current.insertText(text);
        showToast("Inserted into document");
      } else if (mode === "append") {
        editorHandleRef.current.appendText(text);
        showToast("Appended to document");
      } else if (mode === "replace") {
        editorHandleRef.current.replaceSelection(text);
        showToast("Replaced text with AI response");
      } else if (mode === "rewrite") {
        const rewrote = editorHandleRef.current.rewriteSelection(text);
        if (rewrote) {
          showToast("Rewrote selected document text with AI response");
        } else {
          showToast("Please highlight text in the document first to rewrite");
        }
      } else if (mode === "summarize") {
        editorHandleRef.current.summarizeIntoDocument(text);
        showToast("Added summary to document");
      }
    };

    if (!editorHandleRef.current && !editorOpen) {
      setTimeout(executeAction, 250);
    } else {
      executeAction();
    }
  }, [editorOpen, showToast]);

  useEffect(() => { activeThreadIdRef.current = activeThreadId; }, [activeThreadId]);
  useEffect(() => { threadsRef.current = threads; }, [threads]);
  useEffect(() => { setMounted(true); }, []);

  const { messages, sendMessage, setMessages, status } = useChat<ChatSDKMessage>({
    api: "/api/chat",
    body: { threadId: activeThreadId, model: selectedModel, enabledTools },
    onFinish: async ({ message }) => {
      const dbContent = getMessageContent(message);
      const assistantDbId = crypto.randomUUID();

      const pendingUser = pendingUserMessageRef.current;
      if (pendingUser && pendingUser.localThreadId.startsWith("local-")) {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;

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

        await supabase.from("messages").insert({
          id: pendingUser.id,
          thread_id: realThreadId,
          role: "user",
          content: pendingUser.content,
          model: pendingUser.model,
        });

        await supabase.from("messages").insert({
          id: assistantDbId,
          thread_id: realThreadId,
          role: "assistant",
          content: dbContent,
          model: selectedModel,
        });

        setThreads((prev) => [createdThread as ChatThread, ...prev]);

        if (activeThreadIdRef.current === pendingUser.localThreadId) {
          setActiveThreadId(realThreadId);
        }

        pendingUserMessageRef.current = null;

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
              await supabase.from("chat_threads").update({ title }).eq("id", realThreadId);
              setThreads((prev) => prev.map((t) => (t.id === realThreadId ? { ...t, title } : t)));
            }
          } catch { /* ignore */ }
        }
      } else {
        await supabase.from("messages").insert({
          id: assistantDbId,
          thread_id: activeThreadIdRef.current,
          role: "assistant",
          content: dbContent,
          model: selectedModel,
        });

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
              await supabase.from("chat_threads").update({ title }).eq("id", activeThreadIdRef.current);
              setThreads((prev) =>
                prev.map((t) => (t.id === activeThreadIdRef.current ? { ...t, title } : t))
              );
            }
          } catch { /* ignore */ }
        }
      }

      setMessages((prev) =>
        prev.map((msg) => (msg.id === message.id ? { ...msg, id: assistantDbId } : msg))
      );
    },
    onError: (error) => {
      setStatusMessage(`Failed to stream response: ${error.message}`);
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  const messagesRef = useRef<ChatSDKMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const TOOL_DISPLAY: Record<string, string> = {
    calculator: "Using Calculator",
    time: "Getting Current Time",
    stats: "Counting Words",
    weather: "Fetching Weather Data",
    currency: "Converting Currency",
    searchChatHistory: "Searching Chat History",
    searchKnowledgeBase: "Searching Knowledge Base",
  };

  const lastMessage = messages[messages.length - 1];
  const lastMessageContent = lastMessage ? getMessageContent(lastMessage) : "";
  const lastMessageToolInvocations = lastMessage ? getToolInvocations(lastMessage) : [];
  const toolCall = lastMessageToolInvocations[0];

  const toolStatus = (isLoading && toolCall)
    ? (TOOL_DISPLAY[toolCall.toolName] ?? `Using ${toolCall.toolName}`)
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
    { label: "Check the time", icon: "🕒", text: "What time is it right now?" },
    { label: "Solve math", icon: "🧮", text: "Calculate 15% of $850" },
    { label: "Search history", icon: "🔍", text: "Search my chat history for Python code" },
  ];

  async function handleNavigateToThread(threadId: string, messageId?: string) {
    if (activeThreadId === threadId) {
      if (messageId) {
        const el = document.getElementById(`msg-${messageId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setHighlightedMessageId(messageId);
          setTimeout(() => setHighlightedMessageId(null), 2600);
        }
      }
      return;
    }
    setActiveThreadId(threadId);
    setMessages([]);
    if (threadId.startsWith("local-")) { setMessages([]); return; }
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (!error && data) {
      const sdkMessages: ChatSDKMessage[] = (data as ChatMessage[]).map((m) => {
        let textContent = m.content;
        if (m.content.startsWith("[JSON_PARTS]:")) {
          try {
            const parts = JSON.parse(m.content.substring(13));
            textContent = parts
              .map((part: { type: string; text?: string }) => (part.type === "text" ? part.text : ""))
              .join("");
          } catch { /* ignore */ }
        }
        return {
          id: m.id,
          role: m.role as "user" | "assistant",
          parts: [{ type: "text" as const, text: textContent }],
          createdAt: new Date(m.created_at),
        };
      });
      setMessages(sdkMessages);
      if (messageId) {
        setTimeout(() => {
          const el = document.getElementById(`msg-${messageId}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            setHighlightedMessageId(messageId);
            setTimeout(() => setHighlightedMessageId(null), 2600);
          }
        }, 150);
      }
    }
    setLoadingMessages(false);
  }

  async function loadMessages(threadId: string) {
    if (threadId.startsWith("local-")) { setMessages([]); return; }
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
                .map((part: { type: string; text?: string }) => (part.type === "text" ? part.text : ""))
                .join("");
            } catch { /* ignore */ }
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
        if (exists) { setSelectedModel(savedModel); }
        else { setSelectedModel(data.models[0].id); }
      } else { setModels([]); }
    } catch { setModels([]); }
    finally { setLoadingModels(false); }
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

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single();
      setUserRole((profile?.role as "tenant_admin" | "shared_admin" | "user") ?? "user");

      await loadThreads(data.user.id);
      await loadModels();
    };
    void getSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeThreadId]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [draft]);

  function createThread() {
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
      const { error } = await supabase.from("chat_threads").update({ title: newTitle }).eq("id", threadId);
      if (error) { setStatusMessage(`Rename failed: ${error.message}`); return; }
    }
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, title: newTitle } : t)));
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
      if (!isAuthenticated) setStatusMessage("You need to sign in before sending a message.");
      return;
    }

    const rawDraft = draft.trim();
    const currentPdf = pdfContext;
    const dbMessage = rawDraft;
    messageTextRef.current = rawDraft;
    setDraft("");
    setPdfContext(null);
    setStatusMessage(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { setStatusMessage("You need to sign in before sending a message."); return; }

    let threadId = activeThreadId;
    if (!threadId) {
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
        content: dbMessage,
        model: selectedModel,
        localThreadId: finalThreadId,
      };
    } else {
      pendingUserMessageRef.current = null;
      const { error: userError } = await supabase.from("messages").insert({
        id: userMessageId,
        thread_id: finalThreadId,
        role: "user",
        content: dbMessage,
        model: selectedModel,
      });
      if (userError) { setStatusMessage(`Save failed: ${userError.message}`); return; }
    }

    setMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: "user",
        parts: [
          { type: "text", text: rawDraft },
          ...(currentPdf
            ? [{
                type: "file" as const,
                filename: currentPdf.filename,
                mediaType: "application/pdf",
                url: currentPdf.dataUrl,
              }]
            : []),
        ],
        createdAt: new Date(),
      } as ChatSDKMessage,
    ]);

    try {
      await sendMessage(
        {
          text: rawDraft,
          messageId: userMessageId,
          files: currentPdf
            ? [{
                type: "file" as const,
                filename: currentPdf.filename,
                mediaType: "application/pdf",
                url: currentPdf.dataUrl,
              }]
            : undefined,
        },
        {
          body: {
            threadId: finalThreadId,
            model: selectedModel,
            enabledTools,
            pdfContext: currentPdf
              ? { filename: currentPdf.filename, text: currentPdf.text, pages: currentPdf.pages, truncated: currentPdf.truncated }
              : null,
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

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div suppressHydrationWarning className="flex h-screen w-screen overflow-hidden" style={{ background: "#EEF2F6" }}>

      {/* ═══════════════════════════════════════════════════════════════
          LEFT SIDEBAR — Fluent NavigationView (acrylic, light)
      ═══════════════════════════════════════════════════════════════ */}
      <aside
        className={`hidden h-full flex-col shrink-0 transition-all duration-200 lg:flex overflow-hidden relative`}
        style={{
          width: sidebarCollapsed ? "60px" : "264px",
          background: "rgba(242, 245, 250, 0.65)",
          backdropFilter: "blur(30px) saturate(1.4)",
          WebkitBackdropFilter: "blur(30px) saturate(1.4)",
          borderRight: "1px solid rgba(0, 0, 0, 0.04)",
        }}
      >
        {/* App title row */}
        <div
          className={`flex items-center h-14 shrink-0 ${sidebarCollapsed ? "justify-center px-2" : "justify-between px-4"}`}
        >
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <WindowsLogo size={18} />
              <span className="text-[14px] font-semibold tracking-tight text-[#1A1A1A] truncate">
                Chatroom
              </span>
            </div>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? "Open sidebar" : "Collapse sidebar"}
            className="h-8 w-8 text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#E5E5E5] shrink-0"
          >
            {sidebarCollapsed
              ? <PanelLeftOpen className="h-4 w-4" />
              : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        {/* New Chat button */}
        <div className={`shrink-0 ${sidebarCollapsed ? "flex justify-center px-2 pb-2" : "px-3 pb-2"}`}>
          {sidebarCollapsed ? (
            <Tooltip content="New chat" side="right">
              <Button
                onClick={createThread}
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-[#0078D4] hover:bg-[#EBF4FC] hover:text-[#0078D4]"
                aria-label="New chat"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={createThread}
              className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium
                         text-[#0078D4] hover:bg-[#EBF4FC] transition-colors duration-100 cursor-pointer select-none"
            >
              <Plus className="h-4 w-4 shrink-0" />
              New chat
            </button>
          )}
        </div>

        {/* Search box */}
        {!sidebarCollapsed && (
          <div className="px-3 pb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8A8A8A] pointer-events-none" />
              <input
                type="text"
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-sm bg-white border border-[#E5E5E5] rounded-md
                           text-[#1A1A1A] placeholder-[#8A8A8A]
                           focus:outline-none focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4]/30
                           transition-colors duration-100"
              />
            </div>
          </div>
        )}

        {/* Thread list — Fluent NavigationViewItem style */}
        <ScrollArea className="flex-1 min-h-0">
          <div className={`space-y-0.5 py-1 ${sidebarCollapsed ? "px-2" : "px-2"}`}>
            {filteredThreads.map((thread) => {
              const isActive = activeThreadId === thread.id;
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
                  className={`group flex items-center relative
                    ${sidebarCollapsed ? "justify-center p-2" : "justify-between px-3 py-2"}
                    rounded-lg transition-all duration-100 cursor-pointer select-none
                    ${isActive
                      ? "bg-[#E5E5E5] text-[#1A1A1A]"
                      : "text-[#5C5C5C] hover:bg-[#EBEBEB] hover:text-[#1A1A1A]"
                    }`}
                >
                  {/* Active accent pill */}
                  {isActive && !sidebarCollapsed && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-r-sm bg-[#0078D4]"
                      aria-hidden="true"
                    />
                  )}

                  {sidebarCollapsed ? (
                    <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 text-[11px] font-semibold
                                     ${isActive ? "bg-[#0078D4] text-white" : "bg-[#E5E5E5] text-[#5C5C5C]"}`}>
                      {thread.title?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  ) : (
                    <>
                      <p className="truncate text-[13px] leading-normal flex-1 min-w-0 pl-2">
                        {thread.title}
                      </p>
                      <div className={`transition-opacity shrink-0 ml-1 ${
                        isActive
                          ? "opacity-100 pointer-events-auto"
                          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                      }`}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-[#8A8A8A] hover:text-[#1A1A1A] hover:bg-[#DCDCDC] transition-colors cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem
                              className="text-xs gap-2"
                              onClick={(e) => { e.stopPropagation(); startRename(thread); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span>Rename</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-xs gap-2 text-[#C42B1C] focus:text-[#C42B1C] focus:bg-[#FDE7E9]"
                              onClick={(e) => { e.stopPropagation(); void deleteThread(thread.id); }}
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
                <Tooltip key={thread.id} content={thread.title} side="right">
                  {threadContent}
                </Tooltip>
              ) : (
                <div key={thread.id}>{threadContent}</div>
              );
            })}
          </div>
        </ScrollArea>

        {/* User profile footer */}
        {isAuthenticated && (
          <div
            className={`shrink-0 ${sidebarCollapsed ? "p-2" : "p-3"}`}
            style={{ borderTop: "1px solid #E5E5E5" }}
          >
            {sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-1.5">
                <Tooltip content={userEmail || "user@example.com"} side="right">
                  <div className="h-8 w-8 rounded-full bg-[#0078D4] flex items-center justify-center text-xs font-semibold text-white cursor-default select-none">
                    {(userEmail && userEmail[0]?.toUpperCase()) ?? "U"}
                  </div>
                </Tooltip>
                <Tooltip content={editorOpen ? "Close Pages" : "Open Pages"} side="right">
                  <Button variant="ghost" size="icon" onClick={toggleEditor}
                    className={`h-7 w-7 text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#E5E5E5] cursor-pointer ${editorOpen ? "bg-[#EBF4FC] text-[#0078D4]" : ""}`}>
                    <PanelRight className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content="Settings" side="right">
                  <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)}
                    className="h-7 w-7 text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#E5E5E5] cursor-pointer">
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content="Sign out" side="right">
                  <Button variant="ghost" size="icon" onClick={handleSignOut}
                    className="h-7 w-7 text-[#5C5C5C] hover:text-[#C42B1C] hover:bg-[#FDE7E9] cursor-pointer">
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-[#0078D4] flex items-center justify-center text-xs font-semibold text-white shrink-0 select-none">
                    {(userEmail && userEmail[0]?.toUpperCase()) ?? "U"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium truncate text-[#1A1A1A] max-w-[130px]" title={userEmail}>
                      {userEmail}
                    </p>
                    <p className="text-[10px] text-[#8A8A8A]">Signed in</p>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Tooltip content={editorOpen ? "Close Pages" : "Open Pages"} side="top">
                    <Button variant="ghost" size="icon" onClick={toggleEditor}
                      className={`h-7 w-7 text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#E5E5E5] cursor-pointer ${editorOpen ? "bg-[#EBF4FC] text-[#0078D4]" : ""}`}>
                      <PanelRight className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Settings" side="top">
                    <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)}
                      className="h-7 w-7 text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#E5E5E5] cursor-pointer">
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                  <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out"
                    className="h-7 w-7 text-[#5C5C5C] hover:text-[#C42B1C] hover:bg-[#FDE7E9] cursor-pointer">
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ═══════════════════════════════════════════════════════════════
          CENTER + RIGHT — PanelGroup (Chat | Editor)
      ═══════════════════════════════════════════════════════════════ */}
      <PanelGroup orientation="horizontal" id="chat-editor-layout" className="flex-1 min-w-0 h-full">

        {/* Chat panel */}
        <Panel defaultSize="55%" minSize="30%" className="flex flex-col h-full min-w-0">
          <main className="flex flex-1 flex-col h-full min-w-0 overflow-hidden relative bg-[#F8FAFD]">

          {/* ── Chat header command bar ─────────────────────────────── */}
          <div className="win-chat-header">
            {/* Left: Conversation title & Model badge */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-4">
              <span className="text-[15px] font-semibold text-[#1A1F26] truncate">
                {activeThreadId
                  ? (threads.find((t) => t.id === activeThreadId)?.title ?? "New chat")
                  : "New chat"}
              </span>
              <span className="px-2 py-0.5 text-[11px] font-medium text-[#58606B] bg-[#EAEEF4] rounded-md shrink-0 select-none">
                {selectedModel ? (models.find((m) => m.id === selectedModel)?.name ?? selectedModel.split("/").pop()) : "Copilot"}
              </span>
            </div>

            {/* Right: Clean workspace actions */}
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleEditor}
                aria-label={editorOpen ? "Close document panel" : "Open document panel"}
                className={`h-8 px-3 rounded-lg text-xs font-semibold gap-1.5 transition-colors cursor-pointer select-none
                  ${editorOpen
                    ? "bg-[#EBF3FC] text-[#0078D4] hover:bg-[#DDEEFF]"
                    : "text-[#505762] hover:text-[#1A1F26] hover:bg-[#EAEEF4]"}`}
              >
                <PanelRight className="h-4 w-4" />
                <span>Pages</span>
              </Button>
              <Tooltip content="Settings" side="bottom">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSettingsOpen(true)}
                  className="h-8 w-8 rounded-lg text-[#505762] hover:text-[#1A1F26] hover:bg-[#EAEEF4] cursor-pointer"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>
          </div>

        {/* Scrollable message viewport */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {messages.length === 0 ? (
            /* ── Welcome / Empty state ── */
            <div className="flex flex-col items-center min-h-full pt-16 pb-56 px-6 text-center select-none">
              {/* Copilot-style icon */}
              <div className="mb-5 relative">
                <div
                  className="h-12 w-12 rounded-2xl flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, #0078D4 0%, #106EBE 50%, #004E8C 100%)",
                    boxShadow: "0 4px 16px rgba(0,120,212,0.30)",
                  }}
                >
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                {/* Status dot */}
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#107C10] border-2 border-[#FAFAFA]" />
              </div>

              <h1 className="text-[26px] font-semibold tracking-tight text-[#1A1A1A] mb-2">
                What can I help with?
              </h1>
              <p className="text-sm text-[#5C5C5C] mb-8 max-w-[420px] leading-relaxed">
                Ask anything, analyze documents, or run built-in tools to get things done.
              </p>

              {/* Suggestion cards — Fluent Card style */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-[620px] w-full">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => handleSuggestionClick(s.text)}
                    className="flex items-center text-left gap-3 px-4 py-3.5 rounded-xl cursor-pointer group
                               transition-all duration-150
                               bg-white border border-[#E5E5E5] hover:border-[#C7C7C7]
                               hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
                  >
                    <span className="text-xl shrink-0 group-hover:scale-110 transition-transform duration-150 w-8 text-center">
                      {s.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1A1A1A] mb-0.5">{s.label}</p>
                      <p className="text-xs text-[#5C5C5C] truncate max-w-[220px]">{s.text}</p>
                    </div>
                  </button>
                ))}
              </div>

              {loadingModels && (
                <p className="mt-6 text-xs text-[#8A8A8A] animate-pulse">Loading models...</p>
              )}
            </div>
          ) : (
            /* ── Message list ── */
            <div className="max-w-[720px] mx-auto w-full px-6 pt-8 pb-56 space-y-8">
              {loadingMessages ? (
                <div className="flex items-center justify-center gap-2 py-6">
                  <ProgressRing size={16} />
                  <p className="text-xs text-[#8A8A8A]">Loading messages...</p>
                </div>
              ) : null}

              {messages.map((message) => {
                if (message.role !== "user" && message.role !== "assistant") return null;
                const content = getMessageContent(message);
                if (message.role === "assistant" && !content) return null;

                const toolInvocations = getToolInvocations(message);
                const historyToolResult = toolInvocations.find(
                  (t) => t.toolName === "searchChatHistory" && t.state === "result"
                );
                let relatedResults: SearchResult[] = [];
                if (historyToolResult?.result) {
                  try {
                    const parsed = historyToolResult.result as { results?: SearchResult[] };
                    relatedResults = parsed.results ?? [];
                  } catch { /* ignore */ }
                }

                return (
                  <div
                    key={message.id}
                    id={`msg-${message.id}`}
                    className={`w-full win-message-group animate-message-in transition-all duration-300${
                      highlightedMessageId === message.id ? " message-highlight" : ""
                    }`}
                  >
                    {message.role === "user" ? (
                      /* User bubble — Copilot pill */
                      <div className="flex justify-end w-full">
                        <div className="max-w-[80%] flex flex-col gap-1.5 items-end">
                          {/* PDF badge */}
                          {message.parts.some(
                            (p) => p.type === "file" && (p as { type: string; mediaType?: string }).mediaType === "application/pdf"
                          ) && (
                            <div className="flex items-center gap-2.5 bg-white border border-[#CDD6E2] rounded-xl px-4 py-2.5 shadow-2xs">
                              <div className="h-8 w-8 rounded-lg bg-[#FDE7E9] flex items-center justify-center shrink-0">
                                <FileText className="h-4 w-4 text-[#C42B1C]" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[12.5px] font-semibold text-[#1A1F26] truncate max-w-[220px]">
                                  {(message.parts.find((p) => p.type === "file") as { type: string; filename?: string } | undefined)?.filename ?? "Document.pdf"}
                                </p>
                                <p className="text-[10.5px] text-[#606770]">PDF · Analyzed by AI</p>
                              </div>
                            </div>
                          )}
                          {/* Message bubble */}
                          <div
                            className="rounded-[20px] rounded-tr-md px-5 py-3 text-[14.5px] text-[#0D1E30] leading-relaxed break-words shadow-2xs"
                            style={{ background: "#EBF3FC", border: "1px solid #C7DCEF" }}
                          >
                            {content}
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Assistant message — Copilot clean presentation */
                      <div className="flex flex-col gap-2.5 w-full">
                        {/* Copilot Header */}
                        <div className="flex items-center gap-2 select-none">
                          <div
                            className="h-6 w-6 rounded-md flex items-center justify-center shrink-0 shadow-xs"
                            style={{ background: "linear-gradient(135deg, #0078D4 0%, #106EBE 50%, #004E8C 100%)" }}
                          >
                            <Sparkles className="h-3.5 w-3.5 text-white" />
                          </div>
                          <span className="text-[13.5px] font-semibold text-[#1E232B]">Copilot</span>
                        </div>

                        <div className="min-w-0 pl-0.5">
                          <div className="prose prose-slate max-w-none break-words text-[14.5px] leading-[1.75] text-[#222831] font-normal
                                          prose-headings:mt-5 prose-headings:mb-2 prose-headings:font-semibold prose-headings:text-[#1A1F26]
                                          prose-p:my-2.5 prose-ul:my-2 prose-ol:my-2 prose-li:my-1
                                          prose-blockquote:border-l-2 prose-blockquote:border-[#0078D4] prose-blockquote:pl-3.5 prose-blockquote:text-[#505762] prose-blockquote:not-italic
                                          prose-code:rounded-md prose-code:bg-[#EAEEF4] prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-[13px] prose-code:text-[#1A1F26]
                                          prose-pre:overflow-x-auto prose-pre:bg-[#1C2026] prose-pre:text-[#D4DCE6] prose-pre:rounded-xl prose-pre:p-0">
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

                          {relatedResults.length > 0 && (
                            <RelatedConversations results={relatedResults} onNavigate={handleNavigateToThread} />
                          )}

                          {/* Action bar row */}
                          <div className="mt-1">
                            {!isLoading && (
                              <AssistantActionBar
                                content={content}
                                onInsert={() => editorInsert(content, "insert")}
                                onAppend={() => editorInsert(content, "append")}
                                onReplace={() => editorInsert(content, "replace")}
                                onRewrite={() => editorInsert(content, "rewrite")}
                                onSummarize={() => editorInsert(content, "summarize")}
                                onFollowUp={() => {
                                  setDraft(`Follow up on your previous response about: `);
                                  textareaRef.current?.focus();
                                }}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}


              {/* ── Fluent thinking indicator ── */}
              {thinking ? (
                <div className="flex gap-3 w-full">
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "linear-gradient(135deg, #0078D4 0%, #004E8C 100%)" }}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm text-[#5C5C5C] bg-white border border-[#E5E5E5]"
                       style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                    <ProgressRing size={14} />
                    <span>Thinking...</span>
                  </div>
                </div>
              ) : null}

              {/* ── Tool status indicator ── */}
              {toolStatus ? (
                <div className="flex gap-3 w-full">
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "linear-gradient(135deg, #0078D4 0%, #004E8C 100%)" }}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm text-[#5C5C5C] bg-[#EBF4FC] border border-[#C7DDEF]">
                    <ProgressRing size={14} color="#0078D4" />
                    <span>{toolStatus}</span>
                  </div>
                </div>
              ) : null}

              {/* ── Connecting indicator ── */}
              {connectingToStream ? (
                <div className="flex gap-3 w-full">
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "linear-gradient(135deg, #0078D4 0%, #004E8C 100%)" }}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm text-[#5C5C5C] bg-white border border-[#E5E5E5]">
                    <ProgressRing size={14} color="#8A8A8A" />
                    <span>Connecting...</span>
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            Floating Composer — Copilot-style grounded
        ═══════════════════════════════════════════════════════════════ */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
          <div className="max-w-[720px] mx-auto w-full px-6 pb-5 pointer-events-auto">

            {/* Gradient fade */}
            <div
              className="absolute inset-x-0 bottom-0 h-44 pointer-events-none -z-10"
              style={{ background: "linear-gradient(to top, #F8FAFD 60%, rgba(248, 250, 253, 0.8) 80%, transparent)" }}
            />

            {/* Status / error bar */}
            {statusMessage && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-2 mb-2 text-xs font-medium text-[#C42B1C] bg-[#FDE7E9] border border-[#F8C4C8] shadow-2xs">
                <span className="shrink-0">⚠</span>
                <span>{statusMessage}</span>
              </div>
            )}

            {/* ── Copilot Composer card ── */}
            <div
              className="win-composer"
              onDragOver={(e) => {
                const items = Array.from(e.dataTransfer.items);
                if (items.some((i) => i.type === "application/pdf")) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const file = Array.from(e.dataTransfer.files).find((f) => f.type === "application/pdf");
                if (file) { setComposerDragFile(file); setPdfUploadOpen(true); }
              }}
            >
              {/* PDF attachment pill */}
              {pdfContext && (
                <div className="flex items-center gap-2 mx-3 mt-2.5 px-3 py-1.5 rounded-lg bg-[#EAEEF4] border border-[#CDD6E2]">
                  <FileText className="h-3.5 w-3.5 text-[#505762] shrink-0" />
                  <span className="text-xs font-semibold text-[#1A1F26] truncate flex-1">{pdfContext.filename}</span>
                  <span className="text-[11px] text-[#606770] shrink-0">
                    {pdfContext.pages}p · {pdfContext.chars.toLocaleString()} chars
                  </span>
                  <button
                    type="button"
                    onClick={() => setPdfContext(null)}
                    className="h-5 w-5 rounded flex items-center justify-center text-[#606770] hover:text-[#1A1F26] hover:bg-[#D4DCE6] transition-colors cursor-pointer shrink-0"
                    aria-label="Remove PDF"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Textarea — compact default height, auto-grow */}
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask Copilot or brainstorm anything..."
                rows={1}
                className="w-full min-h-[24px] max-h-[160px] px-4 pt-3 pb-1 resize-none border-0 outline-none focus:outline-none focus:ring-0
                           bg-transparent text-[14.5px] leading-relaxed text-[#1A1F26] placeholder-[#808893]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />

              {/* Bottom action bar inside integrated card */}
              <div className="flex items-center gap-1 px-3 pb-2.5 pt-1">

                {/* Left: Attach PDF */}
                <Tooltip content="Attach document or PDF" side="top">
                  <button
                    type="button"
                    onClick={() => { setComposerDragFile(null); setPdfUploadOpen(true); }}
                    className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0
                               text-[#505762] hover:text-[#0078D4] hover:bg-[#EBF3FC]
                               transition-colors duration-100 cursor-pointer"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                </Tooltip>

                {/* Tools dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium
                                 text-[#505762] hover:text-[#1A1F26] hover:bg-[#EAEEF4]
                                 transition-colors duration-100 cursor-pointer select-none"
                    >
                      <Wrench className="h-3.5 w-3.5 text-[#0078D4]" />
                      <span>Tools ({Object.values(enabledTools).filter(Boolean).length})</span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
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
                      checked={enabledTools.stats}
                      onCheckedChange={(checked) => setEnabledTools((prev) => ({ ...prev, stats: checked }))}
                    >Text Statistics</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={enabledTools.searchChatHistory}
                      onCheckedChange={(checked) => setEnabledTools((prev) => ({ ...prev, searchChatHistory: checked }))}
                    >Search Chat History</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={enabledTools.searchKnowledgeBase}
                      onCheckedChange={(checked) => setEnabledTools((prev) => ({ ...prev, searchKnowledgeBase: checked }))}
                    >Knowledge Base</DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Model selector */}
                <DropdownMenu open={modelOpen} onOpenChange={setModelOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium
                                 text-[#505762] hover:text-[#1A1F26] hover:bg-[#EAEEF4]
                                 transition-colors duration-100 cursor-pointer select-none max-w-[180px]"
                    >
                      <span className="truncate">
                        {selectedModel
                          ? (models.find((m) => m.id === selectedModel)?.name ?? selectedModel.replace("nvidia/", "").replace(":free", ""))
                          : "Select Model"}
                      </span>
                      <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72 p-1.5 z-50">
                    <div className="px-2.5 py-1.5 text-[10px] font-bold text-[#8A8A8A] uppercase tracking-wider select-none">
                      AI Models
                    </div>
                    <div className="overflow-y-auto max-h-[60vh] overscroll-contain">
                      <div className="space-y-0.5">
                        {models.map((model) => (
                          <DropdownMenuItem
                            key={model.id}
                            onSelect={() => {
                              setSelectedModel(model.id);
                              localStorage.setItem("selectedModel", model.id);
                              setModelOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm rounded-lg
                                         transition-colors duration-100 cursor-pointer
                                         ${selectedModel === model.id
                                           ? "bg-[#EBF4FC] text-[#0078D4] font-semibold"
                                           : "text-[#1A1F26] hover:bg-[#F0F2F6]"
                                         }`}
                          >
                            <span className="truncate pr-2">{model.name}</span>
                            {selectedModel === model.id && <Check className="h-3.5 w-3.5 text-[#0078D4] shrink-0" />}
                          </DropdownMenuItem>
                        ))}
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Send button — Copilot Blue rounded button */}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isLoading || !draft.trim() || !isAuthenticated}
                  aria-label="Send message"
                  className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-150
                    ${draft.trim() && !isLoading && isAuthenticated
                      ? "bg-[#0078D4] hover:bg-[#106EBE] active:bg-[#005A9E] text-white cursor-pointer shadow-[0_2px_8px_rgba(0,120,212,0.35)] scale-100 hover:scale-105"
                      : "bg-[#EAEEF4] text-[#B0B8C4] cursor-not-allowed"
                    }`}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>

            <p className="text-[11px] text-center text-[#808893] select-none mt-2">
              Copilot can make mistakes. Consider checking important information.
            </p>
          </div>
        </div>
      </main>
        </Panel>

        {/* Drag handle — Windows 11 fluent separator */}
        {editorOpen && (
          <PanelResizeHandle className="win-resize-handle" />
        )}

        {/* Editor panel (Microsoft Word / Loop Pages) */}
        {editorOpen && (
          <Panel
            defaultSize="45%"
            minSize="25%"
            maxSize="75%"
            className="h-full min-w-[320px]"
          >
            <RichTextEditor
              key={activeThreadId || "default"}
              chatId={activeThreadId || "default"}
              onClose={() => { setEditorOpen(false); localStorage.setItem("rte-panel-open", "false"); }}
              onReady={(handle) => { editorHandleRef.current = handle; }}
            />
          </Panel>
        )}

      </PanelGroup>

      {/* ═══════════════════════════════════════════════════════════════
          PDF Upload — Fluent ContentDialog
      ═══════════════════════════════════════════════════════════════ */}
      {pdfUploadOpen && (
        <PdfUpload
          key={composerDragFile?.name ?? "pdf-upload"}
          initialFile={composerDragFile ?? undefined}
          onParsed={(result) => {
            setPdfContext(result);
            setComposerDragFile(null);
          }}
          onClose={() => {
            setPdfUploadOpen(false);
            setComposerDragFile(null);
          }}
        />
      )}

      {/* Settings Panel */}
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          role={userRole}
          isSharedAdmin={userRole === "shared_admin"}
          onModelsRefreshed={(freshModels) => {
            setModels(freshModels);
            if (freshModels.length > 0) {
              const savedModel = typeof window !== "undefined" ? localStorage.getItem("selectedModel") : null;
              const stillExists = savedModel && freshModels.some((m) => m.id === savedModel);
              if (!stillExists) setSelectedModel(freshModels[0].id);
            }
          }}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════
          Rename Dialog — Fluent ContentDialog
      ═══════════════════════════════════════════════════════════════ */}
      {renameThreadId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.36)", backdropFilter: "blur(4px)" }}>
          <div
            className="w-full max-w-md rounded-2xl p-6 animate-fluent-slide-u"
            style={{
              background: "#FFFFFF",
              border: "1px solid #E5E5E5",
              boxShadow: "0 16px 48px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.10)",
            }}
          >
            <h3 className="text-base font-semibold text-[#1A1A1A] mb-1">Rename Chat</h3>
            <p className="text-xs text-[#5C5C5C] mb-4">Enter a new name for this conversation.</p>
            <input
              type="text"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder="Chat title"
              className="w-full h-9 px-3 py-2 text-sm rounded-lg border border-[#C7C7C7]
                         focus:outline-none focus:border-[#0078D4] focus:ring-2 focus:ring-[#0078D4]/20
                         mb-5 bg-white text-[#1A1A1A] transition-colors"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRenameSubmit();
                if (e.key === "Escape") setRenameThreadId(null);
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm"
                onClick={() => setRenameThreadId(null)}
                className="h-8 px-4 text-xs font-medium">Cancel</Button>
              <Button size="sm"
                onClick={handleRenameSubmit}
                disabled={!renameTitle.trim()}
                className="h-8 px-4 text-xs font-medium">Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          Delete Confirmation Dialog — Fluent ContentDialog
      ═══════════════════════════════════════════════════════════════ */}
      {deleteConfirmThreadId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.36)", backdropFilter: "blur(4px)" }}>
          <div
            className="w-full max-w-sm rounded-2xl p-6 animate-fluent-slide-u"
            style={{
              background: "#FFFFFF",
              border: "1px solid #E5E5E5",
              boxShadow: "0 16px 48px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.10)",
            }}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="h-9 w-9 rounded-lg bg-[#FDE7E9] flex items-center justify-center shrink-0">
                <Trash2 className="h-4 w-4 text-[#C42B1C]" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#1A1A1A]">Delete this chat?</h3>
                <p className="text-xs text-[#5C5C5C] mt-1 leading-relaxed">
                  This will permanently delete this conversation and all messages. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm"
                onClick={() => setDeleteConfirmThreadId(null)}
                className="h-8 px-4 text-xs font-medium">Cancel</Button>
              <Button
                size="sm"
                onClick={handleDeleteConfirmSubmit}
                className="h-8 px-4 text-xs font-medium bg-[#C42B1C] hover:bg-[#A52110] active:bg-[#8A1B0D]"
              >Delete</Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          Fluent Toast notification (Insert / Append / Replace feedback)
      ═══════════════════════════════════════════════════════════════ */}
      {toast && (
        <div className="win-toast animate-toast-in" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
