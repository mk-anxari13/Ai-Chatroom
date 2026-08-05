"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { FileText, Upload, X, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Dynamically load Mozilla PDF.js library in the browser
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPdfJs(): Promise<any> {
  if (typeof window !== "undefined" && (window as any).pdfjsLib) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).pdfjsLib;
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfjsLib = (window as any).pdfjsLib;
      if (pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(pdfjsLib);
      } else {
        reject(new Error("Failed to initialize PDF.js library"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load PDF processing library"));
    document.head.appendChild(script);
  });
}

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const MAX_TEXT_CHARS = 50_000;

export interface PdfResult {
  filename: string;
  text: string;
  pages: number;
  chars: number;
  truncated: boolean;
  dataUrl: string;
}

interface PdfUploadProps {
  onParsed: (result: PdfResult) => void;
  onClose: () => void;
  /** If a file is pre-loaded (e.g. dropped on the composer), start uploading immediately */
  initialFile?: File;
}

type UploadState =
  | { status: "idle" }
  | { status: "reading"; progress: number; filename: string }
  | { status: "parsing"; page: number; totalPages: number; filename: string }
  | { status: "done"; result: PdfResult }
  | { status: "error"; message: string };

export function PdfUpload({ onParsed, onClose, initialFile }: PdfUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const processFile = useCallback(
    async (file: File) => {
      // Client-side validation
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setState({ status: "error", message: "Invalid file type. Only PDF files are supported." });
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        setState({
          status: "error",
          message: `File too large (${sizeMB} MB). Maximum size is 15 MB.`,
        });
        return;
      }

      setState({ status: "reading", progress: 20, filename: file.name });

      try {
        // Step 1: Convert to Data URL for Vercel AI SDK
        const dataUrlPromise = new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Step 2: Read ArrayBuffer for PDF text parsing
        const arrayBufferPromise = file.arrayBuffer();

        // Step 3: Load PDF.js engine in browser
        const pdfjsPromise = loadPdfJs();

        const [dataUrl, arrayBuffer, pdfjs] = await Promise.all([
          dataUrlPromise,
          arrayBufferPromise,
          pdfjsPromise,
        ]);

        setState({ status: "reading", progress: 60, filename: file.name });

        // Step 4: Load PDF document with pdfjs in browser
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;
        const totalPages = pdfDoc.numPages;

        if (totalPages === 0) {
          setState({ status: "error", message: "PDF document appears to be empty." });
          return;
        }

        let fullText = "";

        // Extract text page by page with progress updates
        for (let i = 1; i <= totalPages; i++) {
          setState({ status: "parsing", page: i, totalPages, filename: file.name });
          const page = await pdfDoc.getPage(i);
          const textContent = await page.getTextContent();

          const pageText = textContent.items
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((item: any) => ("str" in item ? item.str : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

          if (pageText) {
            fullText += `--- Page ${i} ---\n${pageText}\n\n`;
          }
        }

        const rawText = fullText.trim();

        if (!rawText) {
          setState({
            status: "error",
            message:
              "No readable text could be extracted from this PDF. It may contain scanned image pages (OCR not supported).",
          });
          return;
        }

        const truncated = rawText.length > MAX_TEXT_CHARS;
        const text = truncated ? rawText.slice(0, MAX_TEXT_CHARS) : rawText;

        const result: PdfResult = {
          filename: file.name,
          text,
          pages: totalPages,
          chars: text.length,
          truncated,
          dataUrl,
        };

        setState({ status: "done", result });
        await new Promise((r) => setTimeout(r, 400));
        onParsed(result);
        onClose();
      } catch (err) {
        console.error("Browser PDF parsing error:", err);
        const errMsg = String(err);
        if (errMsg.includes("Password") || errMsg.includes("encrypted")) {
          setState({
            status: "error",
            message: "This PDF is password-protected and cannot be read.",
          });
        } else {
          setState({
            status: "error",
            message: "Failed to read PDF file. It may be corrupted or format unsupported.",
          });
        }
      }
    },
    [onParsed, onClose]
  );

  // If an initial file was provided (e.g. drag onto composer), start processing immediately
  useEffect(() => {
    if (initialFile) {
      void processFile(initialFile);
    }
  }, [initialFile, processFile]);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    e.target.value = "";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  }

  const isBusy = state.status === "reading" || state.status === "parsing";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.36)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isBusy) onClose();
      }}
    >
      {/* Fluent ContentDialog */}
      <div
        className="w-full max-w-[440px] rounded-2xl overflow-hidden animate-fluent-slide-u"
        style={{
          background: "#FFFFFF",
          border: "1px solid #E5E5E5",
          boxShadow: "0 16px 48px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.10)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid #F3F3F3" }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, #0078D4 0%, #004E8C 100%)" }}
            >
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A]">Attach PDF</p>
              <p className="text-[11px] text-[#8A8A8A]">Max 15 MB · Text PDFs only</p>
            </div>
          </div>
          {!isBusy && (
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 rounded-md flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#F3F3F3] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5">
          {/* IDLE state */}
          {state.status === "idle" && (
            <div
              ref={dropZoneRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className="relative flex flex-col items-center justify-center gap-3 rounded-xl px-6 py-10 text-center transition-all duration-150 cursor-pointer"
              style={{
                border: isDraggingOver ? "2px dashed #0078D4" : "2px dashed #C7C7C7",
                background: isDraggingOver ? "#EBF4FC" : "#FAFAFA",
              }}
            >
              <div
                className="h-12 w-12 rounded-2xl flex items-center justify-center transition-all"
                style={{
                  background: isDraggingOver
                    ? "linear-gradient(135deg, #0078D4 0%, #004E8C 100%)"
                    : "#F3F3F3",
                  border: "1px solid #E5E5E5",
                }}
              >
                <Upload
                  className={`h-5 w-5 transition-colors ${
                    isDraggingOver ? "text-white" : "text-[#8A8A8A]"
                  }`}
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1A1A1A]">
                  {isDraggingOver ? "Drop to attach" : "Drag & drop your PDF here"}
                </p>
                <p className="text-xs text-[#8A8A8A] mt-0.5">or click the button below to browse</p>
              </div>
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-1 h-9 px-5 text-xs font-medium cursor-pointer"
              >
                Choose PDF
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          )}

          {/* READING state */}
          {state.status === "reading" && (
            <div className="flex flex-col gap-4 py-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-[#EBF4FC] flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-[#0078D4]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1A1A1A] truncate">{state.filename}</p>
                  <p className="text-xs text-[#8A8A8A] mt-0.5">Loading document...</p>
                </div>
                <span className="text-xs font-semibold text-[#0078D4] shrink-0">
                  {state.progress}%
                </span>
              </div>
              {/* Fluent ProgressBar */}
              <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "rgba(0,120,212,0.15)" }}>
                <div
                  className="h-full rounded-full transition-all duration-200"
                  style={{ width: `${state.progress}%`, background: "#0078D4" }}
                />
              </div>
            </div>
          )}

          {/* PARSING state */}
          {state.status === "parsing" && (
            <div className="flex flex-col gap-4 py-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-[#EBF4FC] flex items-center justify-center shrink-0">
                  <Loader2 className="h-5 w-5 text-[#0078D4] animate-spin" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1A1A1A] truncate">{state.filename}</p>
                  <p className="text-xs text-[#8A8A8A] mt-0.5">
                    Extracting page {state.page} of {state.totalPages}...
                  </p>
                </div>
              </div>
              {/* Indeterminate ProgressBar */}
              <div className="win-progress-bar" />
            </div>
          )}

          {/* DONE state — Fluent success InfoBar */}
          {state.status === "done" && (
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-3.5"
              style={{ background: "#EFF8EF", border: "1px solid #C3E6C3" }}
            >
              <div className="h-9 w-9 rounded-lg bg-[#107C10]/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-5 w-5 text-[#107C10]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#107C10]">{state.result.filename}</p>
                <p className="text-xs text-[#107C10]/80 mt-0.5">
                  {state.result.pages} {state.result.pages === 1 ? "page" : "pages"} ·{" "}
                  {state.result.chars.toLocaleString()} characters extracted
                </p>
              </div>
            </div>
          )}

          {/* ERROR state — Fluent error InfoBar */}
          {state.status === "error" && (
            <div className="flex flex-col gap-4 py-2">
              <div
                className="flex items-start gap-3 rounded-xl px-4 py-3.5"
                style={{ background: "#FDE7E9", border: "1px solid #F8C4C8" }}
              >
                <AlertCircle className="h-4 w-4 text-[#C42B1C] shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-[#C42B1C]">Upload failed</p>
                  <p className="text-xs text-[#C42B1C]/80 mt-0.5 leading-relaxed">{state.message}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    setState({ status: "idle" });
                    fileInputRef.current?.click();
                  }}
                  className="flex-1 h-9 text-xs font-medium cursor-pointer"
                >
                  Try Again
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="h-9 px-4 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
