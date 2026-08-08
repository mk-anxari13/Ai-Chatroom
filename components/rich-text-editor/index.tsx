"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useEffect, useCallback, useState, useRef } from "react";
import { EditorToolbar } from "./toolbar";
import { Download, Copy, Check, X, FileText, Clock } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// ── Markdown to HTML conversion & sanitization ───────────────
function parseMarkdownToHTML(markdown: string): string {
  if (!markdown || !markdown.trim()) return "";
  try {
    const rawHtml = marked.parse(markdown.trim(), {
      async: false,
      breaks: true,
      gfm: true,
    }) as string;

    const enhancedHtml = rawHtml
      .replace(/<ul[^>]*class="[^"]*contains-task-list[^"]*"[^>]*>/gi, '<ul data-type="taskList">')
      .replace(/<li[^>]*class="[^"]*task-list-item[^"]*"[^>]*>/gi, '<li data-type="taskItem">');

    if (typeof window !== "undefined") {
      return DOMPurify.sanitize(enhancedHtml, {
        USE_PROFILES: { html: true },
        ADD_TAGS: ["input", "col", "colgroup", "tbody", "thead", "tfoot", "tr", "th", "td", "pre", "code", "blockquote", "del", "s"],
        ADD_ATTR: ["target", "rel", "class", "type", "disabled", "checked", "data-type", "data-checked", "style", "colspan", "rowspan"],
      });
    }
    return enhancedHtml;
  } catch (e) {
    console.error("Failed to parse markdown:", e);
    return markdown;
  }
}

// ── localStorage key ─────────────────────────────────────────
// Keys are dynamically generated using chatId

// ── Markdown export (simple serialiser) ──────────────────────
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi,   (_, t) => `# ${strip(t)}\n\n`)
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi,   (_, t) => `## ${strip(t)}\n\n`)
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi,   (_, t) => `### ${strip(t)}\n\n`)
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, (_, t) => `**${strip(t)}**`)
    .replace(/<b[^>]*>(.*?)<\/b>/gi,     (_, t) => `**${strip(t)}**`)
    .replace(/<em[^>]*>(.*?)<\/em>/gi,   (_, t) => `_${strip(t)}_`)
    .replace(/<u[^>]*>(.*?)<\/u>/gi,     (_, t) => `<u>${strip(t)}</u>`)
    .replace(/<del[^>]*>(.*?)<\/del>/gi, (_, t) => `~~${strip(t)}~~`)
    .replace(/<code[^>]*>(.*?)<\/code>/gi,(_, t) => `\`${strip(t)}\``)
    .replace(/<pre[^>]*>.*?<code[^>]*>([\s\S]*?)<\/code>.*?<\/pre>/gi, (_, t) => `\`\`\`\n${strip(t)}\n\`\`\`\n\n`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => strip(t).split("\n").map((l: string) => `> ${l}`).join("\n") + "\n\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi,   (_, t) => `- ${strip(t)}\n`)
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href, text) => `[${strip(text)}](${href})`)
    .replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, (_, src) => `![image](${src})`)
    .replace(/<p[^>]*>(.*?)<\/p>/gi,     (_, t) => `${strip(t)}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

// ── Relative time helper ──────────────────────────────────────
function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5)  return "Just saved";
  if (diffSec < 60) return `Saved ${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Saved ${diffMin}m ago`;
  return `Saved ${Math.floor(diffMin / 60)}h ago`;
}

// ── Imperative handle type (exported for ChatApp to use) ─────
export interface EditorHandle {
  insertText: (text: string) => void;
  appendText: (text: string) => void;
  replaceSelection: (text: string) => boolean; // replaces selection, or entire content if no selection
  replaceContent: (text: string) => void; // replaces the entire document content
  rewriteSelection: (text: string) => boolean; // replaces selection with rewritten text
  summarizeIntoDocument: (text: string) => void; // inserts formatted summary block
  getSelectedText: () => string;
}

// ── Main component ───────────────────────────────────────────

interface RichTextEditorProps {
  chatId: string;
  onClose: () => void;
  /** Called once the editor is ready, passing an imperative handle */
  onReady?: (handle: EditorHandle | null) => void;
}

export function RichTextEditor({ chatId, onClose, onReady }: RichTextEditorProps) {
  const lsContentKey = `rte-content-${chatId}`;
  const lsTitleKey = `rte-title-${chatId}`;

  const [title, setTitle] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem(lsTitleKey) ?? "Untitled document";
    return "Untitled document";
  });
  const [copied, setCopied] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState("Auto-saved");
  const saveLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update relative save label every 30s
  useEffect(() => {
    if (!lastSaved) return;
    const interval = setInterval(() => setSaveLabel(relativeTime(lastSaved)), 30_000);
    return () => clearInterval(interval);
  }, [lastSaved]);

  const editor = useEditor({
    immediatelyRender: false, // Next.js App Router SSR safety
    extensions: [
      StarterKit.configure({
        heading:       { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock:     { HTMLAttributes: { class: "rte-code-block" } },
        bulletList:    { HTMLAttributes: { class: "rte-bullet-list" } },
        orderedList:   { HTMLAttributes: { class: "rte-ordered-list" } },
        link:          false,
        underline:     false,
      }),
      Underline,
      Link.configure({
        openOnClick: true,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ HTMLAttributes: { class: "rte-image" } }),
      Placeholder.configure({ placeholder: "Start writing… or paste AI responses here." }),
      CharacterCount,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: typeof window !== "undefined" ? (localStorage.getItem(lsContentKey) ?? "<p></p>") : "<p></p>",
    onUpdate({ editor: ed }) {
      // Auto-save to localStorage on every change
      localStorage.setItem(lsContentKey, ed.getHTML());
      // Update word count
      const text = ed.state.doc.textContent;
      const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
      setWordCount(words);
      // Save indicator
      setIsSaving(true);
      if (saveLabelTimerRef.current) clearTimeout(saveLabelTimerRef.current);
      saveLabelTimerRef.current = setTimeout(() => {
        const now = new Date();
        setLastSaved(now);
        setSaveLabel(relativeTime(now));
        setIsSaving(false);
      }, 600);
    },
  });

  // Persist title
  useEffect(() => {
    localStorage.setItem(lsTitleKey, title);
  }, [title, lsTitleKey]);

  // Register the imperative handle with the parent (ChatApp)
  useEffect(() => {
    if (!editor || !onReady) return;

    const handle: EditorHandle = {
      insertText: (text: string) => {
        const html = parseMarkdownToHTML(text);
        editor.chain().focus().insertContent(html).run();
      },
      appendText: (text: string) => {
        const html = parseMarkdownToHTML(text);
        editor.chain().focus("end").insertContent(html).run();
      },
      replaceContent: (text: string) => {
        const html = parseMarkdownToHTML(text);
        editor.chain().focus().setContent(html).run();
      },
      replaceSelection: (text: string): boolean => {
        const { from, to } = editor.state.selection;
        const html = parseMarkdownToHTML(text);
        if (from === to) {
          // If no selection is active, Replace replaces the editor content as per requirements
          editor.chain().focus().setContent(html).run();
          return true;
        }
        editor.chain().focus().deleteSelection().insertContent(html).run();
        return true;
      },
      rewriteSelection: (text: string): boolean => {
        const { from, to } = editor.state.selection;
        if (from === to) return false;
        const html = parseMarkdownToHTML(text);
        editor.chain().focus().deleteSelection().insertContent(html).run();
        return true;
      },
      summarizeIntoDocument: (text: string) => {
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        const firstHeading = lines.find(l => l.startsWith("#"))?.replace(/^#+\s*/, "") ?? "Key Highlights";
        const bulletPoints = lines
          .filter(l => !l.startsWith("#") && l !== firstHeading)
          .slice(0, 5)
          .map(l => l.startsWith("-") ? l : `- ${l}`)
          .join("\n");
        const summaryBlock = `### 📋 Summary: ${firstHeading}\n\n${bulletPoints}\n\n---\n\n`;
        const html = parseMarkdownToHTML(summaryBlock);
        const { from, to } = editor.state.selection;
        if (from !== to || from > 0) {
          editor.chain().focus().insertContent(html).run();
        } else {
          editor.chain().focus("end").insertContent(html).run();
        }
      },
      getSelectedText: (): string => {
        const { from, to } = editor.state.selection;
        if (from === to) return "";
        return editor.state.doc.textBetween(from, to, " ");
      },
    };

    onReady(handle);
    
    return () => {
      onReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Export as Markdown file
  const handleExportMd = useCallback(() => {
    if (!editor) return;
    const md = htmlToMarkdown(editor.getHTML());
    const blob = new Blob([md], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, "_") || "document"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [editor, title]);

  // Copy as Markdown
  const handleCopyMd = useCallback(async () => {
    if (!editor) return;
    const md = htmlToMarkdown(editor.getHTML());
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [editor]);

  if (!editor) return null;

  const charCount = editor.storage.characterCount?.characters?.() ?? 0;

  return (
    <div
      className="flex flex-col h-full overflow-hidden border-l border-[#DFE5EE]"
      style={{ background: "#F0F3F8" }}
    >
      {/* ── Document title & command header (Word / Loop Ribbon Top) ──── */}
      <div
        className="shrink-0 px-6 pt-3.5 pb-2.5 bg-white border-b border-[#EAEEEF] shadow-2xs"
      >
        {/* Title row */}
        <div className="flex items-center gap-2.5 mb-1.5">
          <div className="h-7 w-7 rounded-lg bg-[#EBF3FC] flex items-center justify-center shrink-0">
            <FileText className="h-4 w-4 text-[#0078D4]" />
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 text-[17px] font-semibold text-[#1B1F24] bg-transparent border-none outline-none min-w-0
                       placeholder:text-[#ABABAB] hover:text-[#0078D4] transition-colors"
            placeholder="Untitled document - Loop Page"
            aria-label="Document title"
          />
          <button
            type="button"
            onClick={onClose}
            title="Close document"
            className="flex items-center justify-center h-8 w-8 rounded-lg text-[#606770]
                       hover:bg-[#F0F2F5] hover:text-[#1B1F24] transition-colors cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Meta row: save status + actions */}
        <div className="flex items-center justify-between pl-9">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${isSaving ? "bg-[#0078D4] animate-save-pulse" : "bg-[#107C10]"}`}
              title={isSaving ? "Saving…" : "Saved to storage"}
            />
            <span className="text-[11.5px] font-medium text-[#606770]">
              {isSaving ? "Saving…" : (lastSaved ? saveLabel : "Saved")}
            </span>
            <span className="text-[#D0D7DE] font-bold">·</span>
            <Clock className="h-3 w-3 text-[#8D96A0]" />
            <span className="text-[11.5px] text-[#606770]">
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
            {charCount > 0 && (
              <>
                <span className="text-[#D0D7DE] font-bold">·</span>
                <span className="text-[11.5px] text-[#8D96A0]">{charCount.toLocaleString()} chars</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExportMd}
              title="Export as Markdown"
              className="flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[11.5px] font-medium text-[#505762]
                         hover:bg-[#EBF3FC] hover:text-[#0078D4] transition-colors cursor-pointer"
            >
              <Download className="h-3 w-3" />
              <span>Export</span>
            </button>
            <button
              type="button"
              onClick={() => void handleCopyMd()}
              title="Copy as Markdown"
              className="flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[11.5px] font-medium text-[#505762]
                         hover:bg-[#EBF3FC] hover:text-[#0078D4] transition-colors cursor-pointer"
            >
              {copied ? <Check className="h-3 w-3 text-[#107C10]" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? "Copied!" : "Copy MD"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Ribbon Toolbar ────────────────────────────────────── */}
      <div className="shrink-0 bg-white z-10">
        <EditorToolbar editor={editor} />
      </div>

      {/* ── Document body — paper surface ─────────────────────── */}
      <div className="flex-1 overflow-y-auto rte-scroll bg-[#F0F3F8] p-6">
        <div className="win-document-page max-w-[720px] mx-auto px-14 py-12 min-h-[720px] transition-all duration-200">
          <EditorContent
            editor={editor}
            className="rte-prose outline-none"
          />
        </div>
      </div>
    </div>
  );
}
