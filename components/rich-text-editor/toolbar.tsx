"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered, ListTodo,
  Code2, Quote, Minus,
  Link2, Table, Image,
  Undo2, Redo2,
  AlignLeft,
  Type,
} from "lucide-react";

interface ToolbarProps {
  editor: Editor;
}

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}

function ToolbarButton({ onClick, active, disabled, title, children, wide }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // prevent focus loss from editor
        if (!disabled) onClick();
      }}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={[
        wide ? "flex items-center justify-center h-7 px-2 rounded-md text-xs gap-1 transition-all duration-100 cursor-pointer"
              : "flex items-center justify-center h-7 w-7 rounded-md text-xs transition-all duration-100 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]/40",
        active
          ? "bg-[#EBF4FC] text-[#0078D4] font-semibold"
          : "text-[#5C5C5C] hover:bg-[#EBEBEB] hover:text-[#1A1A1A]",
        disabled ? "opacity-30 cursor-not-allowed" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ── Ribbon section with label ────────────────────────────────
function RibbonSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="win-ribbon-section">
      <div className="win-ribbon-buttons">{children}</div>
      <span className="win-ribbon-label">{label}</span>
    </div>
  );
}

export function EditorToolbar({ editor }: ToolbarProps) {
  // ── Link ────────────────────────────────────────────────────
  function handleLink() {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("Enter URL:", "https://");
    if (url && url !== "https://") {
      editor.chain().focus().setLink({ href: url, target: "_blank" }).run();
    }
  }

  // ── Table ───────────────────────────────────────────────────
  function handleTable() {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  // ── Image ───────────────────────────────────────────────────
  function handleImage() {
    const url = window.prompt("Enter image URL:", "https://");
    if (url && url !== "https://") {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }

  return (
    <div className="win-ribbon" role="toolbar" aria-label="Document editor toolbar">

      {/* ── Undo / Redo ─────────────────────────────────── */}
      <RibbonSection label="Undo">
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </ToolbarButton>
      </RibbonSection>

      {/* ── Paragraph / Headings ────────────────────────── */}
      <RibbonSection label="Paragraph">
        <ToolbarButton
          onClick={() => editor.chain().focus().setParagraph().run()}
          active={editor.isActive("paragraph")}
          title="Normal text"
        >
          <Type className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive("heading", { level: 1 })}
          title="Heading 1"
        >
          <Heading1 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
        >
          <Heading2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="Heading 3"
        >
          <Heading3 className="h-3.5 w-3.5" />
        </ToolbarButton>
      </RibbonSection>

      {/* ── Text styles ─────────────────────────────────── */}
      <RibbonSection label="Format">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="Underline (Ctrl+U)"
        >
          <Underline className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive("code")}
          title="Inline code"
        >
          <Code2 className="h-3.5 w-3.5" />
        </ToolbarButton>
      </RibbonSection>

      {/* ── Lists ───────────────────────────────────────── */}
      <RibbonSection label="Lists">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={editor.isActive("taskList")}
          title="Task list"
        >
          <ListTodo className="h-3.5 w-3.5" />
        </ToolbarButton>
      </RibbonSection>

      {/* ── Blocks ──────────────────────────────────────── */}
      <RibbonSection label="Blocks">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive("codeBlock")}
          title="Code block"
        >
          <span className="font-mono text-[11px] font-bold leading-none">{"{ }"}</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="Blockquote"
        >
          <Quote className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Divider"
        >
          <Minus className="h-3.5 w-3.5" />
        </ToolbarButton>
      </RibbonSection>

      {/* ── Insert ──────────────────────────────────────── */}
      <RibbonSection label="Insert">
        <ToolbarButton
          onClick={handleLink}
          active={editor.isActive("link")}
          title={editor.isActive("link") ? "Remove link" : "Insert link"}
        >
          <Link2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={handleTable}
          title="Insert table (3×3)"
        >
          <Table className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={handleImage}
          title="Insert image URL"
        >
          <Image className="h-3.5 w-3.5" />
        </ToolbarButton>
      </RibbonSection>

    </div>
  );
}
