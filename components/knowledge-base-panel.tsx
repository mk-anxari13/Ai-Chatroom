"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PdfUpload, type PdfResult } from "@/components/pdf-upload";
import {
  FileText,
  Upload,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  BookOpen,
  Clock,
  X,
  Users,
  UserPlus,
  Mail,
  Shield,
  ChevronDown,
  Globe,
  Lock,
} from "lucide-react";
import type { KBDocument, DocumentStatus } from "@/types";
import { SHARED_TENANT_ID } from "@/types";

// ── Sub-types ────────────────────────────────────────────────

interface Member {
  id: string;
  email: string;
  role: "tenant_admin" | "shared_admin" | "user";
}

interface PendingInvite {
  id: string;
  email: string;
  role: "tenant_admin" | "shared_admin" | "user";
  created_at: string;
}

interface KnowledgeBasePanelProps {
  isSharedAdmin?: boolean;
}

// ── Badges ───────────────────────────────────────────────────

function StatusBadge({ status }: { status: DocumentStatus }) {
  const map: Record<DocumentStatus, { label: string; className: string }> = {
    pending:    { label: "Pending",    className: "bg-zinc-100 text-zinc-500" },
    processing: { label: "Processing", className: "bg-blue-50 text-blue-600 animate-pulse" },
    done:       { label: "Ready",      className: "bg-emerald-50 text-emerald-700" },
    error:      { label: "Error",      className: "bg-red-50 text-red-600" },
  };
  const { label, className } = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}>
      {status === "processing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {status === "done"       && <CheckCircle2 className="h-2.5 w-2.5" />}
      {status === "error"      && <AlertCircle className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function RoleBadge({ role }: { role: "tenant_admin" | "shared_admin" | "user" }) {
  if (role === "tenant_admin") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-violet-50 text-violet-700">
        <Shield className="h-2.5 w-2.5" />Admin
      </span>
    );
  }
  if (role === "shared_admin") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <Shield className="h-2.5 w-2.5" />Shared Admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-zinc-100 text-zinc-500">
      User
    </span>
  );
}

function SharedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
      <Globe className="h-2.5 w-2.5" />Shared
    </span>
  );
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Document Card ────────────────────────────────────────────

interface DocCardProps {
  doc: KBDocument;
  isShared: boolean;
  canManage: boolean; // true if user has write permission on this doc
  deletingId: string | null;
  confirmDeleteId: string | null;
  reprocessingId: string | null;
  onDelete: (id: string) => void;
  onReprocess: (id: string) => void;
  onConfirmDelete: (id: string | null) => void;
}

function DocCard({
  doc, isShared, canManage,
  deletingId, confirmDeleteId, reprocessingId,
  onDelete, onReprocess, onConfirmDelete,
}: DocCardProps) {
  const isDeleting = deletingId === doc.id;
  const isReprocessing = reprocessingId === doc.id;
  const confirmDelete = confirmDeleteId === doc.id;

  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 hover:border-zinc-200 transition-colors">
      {/* Top row */}
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-white border border-zinc-200 flex items-center justify-center shrink-0">
          <FileText className="h-4 w-4 text-zinc-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-zinc-800 truncate" title={doc.filename}>
            {doc.filename}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={doc.processing_status} />
            {isShared && <SharedBadge />}
            {doc.chunk_count > 0 && (
              <span className="text-[10px] text-zinc-400">{doc.chunk_count} chunks</span>
            )}
            {doc.file_size_bytes != null && (
              <span className="text-[10px] text-zinc-400">{formatBytes(doc.file_size_bytes)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Meta */}
      <div className="mt-2 ml-11 flex items-center gap-3 text-[10px] text-zinc-400">
        <span className="flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {new Date(doc.upload_date).toLocaleDateString([], {
            month: "short", day: "numeric", year: "numeric",
          })}
        </span>
        {doc.profiles?.email && (
          <span className="truncate max-w-[160px]">by {doc.profiles.email}</span>
        )}
      </div>

      {doc.processing_status === "error" && doc.error_message && (
        <p className="mt-2 ml-11 text-[11px] text-red-500 leading-snug">
          {doc.error_message}
        </p>
      )}

      {/* Actions */}
      <div className="mt-3 ml-11 flex items-center gap-2">
        {canManage ? (
          <>
            <button
              type="button"
              onClick={() => onReprocess(doc.id)}
              disabled={isReprocessing || isDeleting}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${isReprocessing ? "animate-spin" : ""}`} />
              Re-process
            </button>

            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-red-600 font-medium">Delete?</span>
                <button
                  type="button"
                  onClick={() => onDelete(doc.id)}
                  disabled={isDeleting}
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer"
                >
                  {isDeleting ? "Deleting..." : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => onConfirmDelete(null)}
                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onConfirmDelete(doc.id)}
                disabled={isDeleting || isReprocessing}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            )}
          </>
        ) : (
          /* Read-only notice for shared docs when user is not shared_admin */
          <span className="flex items-center gap-1 text-[11px] text-zinc-400 italic">
            <Lock className="h-3 w-3" />
            Read-only · Managed by Shared Admin
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

export function KnowledgeBasePanel({ isSharedAdmin = false }: KnowledgeBasePanelProps) {
  // Documents
  const [ownDocuments, setOwnDocuments] = useState<KBDocument[]>([]);
  const [sharedDocuments, setSharedDocuments] = useState<KBDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  // Upload — own KB
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // Upload — shared KB
  const [uploadingShared, setUploadingShared] = useState(false);
  const [uploadErrorShared, setUploadErrorShared] = useState<string | null>(null);
  const [showUploadShared, setShowUploadShared] = useState(false);

  // Shared action state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  // Team state
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"user" | "tenant_admin">("user");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [cancellingInviteId, setCancellingInviteId] = useState<string | null>(null);

  // ── Loaders ────────────────────────────────────────────────

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const res = await fetch("/api/kb/documents");
      if (res.ok) {
        const data = (await res.json()) as { documents: KBDocument[] };
        const all = data.documents ?? [];
        setOwnDocuments(all.filter((d) => !d.is_shared_doc));
        setSharedDocuments(all.filter((d) => d.is_shared_doc));
      }
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  const loadTeam = useCallback(async () => {
    setLoadingTeam(true);
    try {
      const res = await fetch("/api/kb/members");
      if (res.ok) {
        const data = (await res.json()) as {
          members: Member[];
          pendingInvites: PendingInvite[];
        };
        setMembers(data.members ?? []);
        setPendingInvites(data.pendingInvites ?? []);
      }
    } finally {
      setLoadingTeam(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
    void loadTeam();
  }, [loadDocuments, loadTeam]);

  // ── Upload handlers ────────────────────────────────────────

  async function handlePdfParsed(result: PdfResult, target: "own" | "shared" = "own") {
    const isSharedTarget = target === "shared";
    if (isSharedTarget) {
      setShowUploadShared(false);
      setUploadingShared(true);
      setUploadErrorShared(null);
    } else {
      setShowUpload(false);
      setUploading(true);
      setUploadError(null);
    }

    try {
      const res = await fetch("/api/kb/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: result.filename,
          extractedText: result.text,
          fileSizeBytes: 0,
          target,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Upload failed");
      }
      await loadDocuments();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      if (isSharedTarget) setUploadErrorShared(msg);
      else setUploadError(msg);
    } finally {
      if (isSharedTarget) setUploadingShared(false);
      else setUploading(false);
    }
  }

  // ── Document action handlers ───────────────────────────────

  async function handleDelete(docId: string) {
    setDeletingId(docId);
    setConfirmDeleteId(null);
    try {
      await fetch(`/api/kb/documents/${docId}`, { method: "DELETE" });
      setOwnDocuments((prev) => prev.filter((d) => d.id !== docId));
      setSharedDocuments((prev) => prev.filter((d) => d.id !== docId));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleReprocess(docId: string) {
    setReprocessingId(docId);
    try {
      const res = await fetch(`/api/kb/documents/${docId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reprocess" }),
      });
      if (res.ok) {
        const { document: updated } = (await res.json()) as { document: KBDocument };
        const updater = (prev: KBDocument[]) =>
          prev.map((d) => (d.id === docId ? { ...d, ...updated } : d));
        setOwnDocuments(updater);
        setSharedDocuments(updater);
      }
    } finally {
      setReprocessingId(null);
    }
  }

  // ── Invite handlers ───────────────────────────────────────

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    setInviting(true);

    try {
      const res = await fetch("/api/kb/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = (await res.json()) as { success?: boolean; error?: string; email?: string };

      if (!res.ok) throw new Error(data.error ?? "Invite failed");

      setInviteSuccess(`Invite sent to ${data.email ?? inviteEmail}`);
      setInviteEmail("");
      setInviteRole("user");
      await loadTeam();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  }

  async function handleCancelInvite(inviteId: string) {
    setCancellingInviteId(inviteId);
    try {
      await fetch(`/api/kb/members/${inviteId}`, { method: "DELETE" });
      setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } finally {
      setCancellingInviteId(null);
    }
  }

  // ── Derived stats ─────────────────────────────────────────

  const ownReady = ownDocuments.filter((d) => d.processing_status === "done").length;
  const ownChunks = ownDocuments.reduce((s, d) => s + (d.chunk_count ?? 0), 0);
  const sharedReady = sharedDocuments.filter((d) => d.processing_status === "done").length;

  return (
    <div className="space-y-8">

      {/* ── TEAM MEMBERS SECTION ─────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-4 w-4 text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-800">Team Members</h3>
          <span className="ml-auto text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">Admin only</span>
        </div>
        <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
          Invite colleagues to your organization. Admins can upload documents; Users can chat and search the knowledge base.
        </p>

        {/* Invite form */}
        <form onSubmit={(e) => void handleInvite(e)} className="mb-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
              <input
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null); setInviteSuccess(null); }}
                required
                className="w-full pl-8 pr-3 h-9 rounded-xl border border-zinc-200 bg-white text-[13px] text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 transition-colors"
              />
            </div>

            {/* Role selector */}
            <div className="relative">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "user" | "tenant_admin")}
                className="appearance-none h-9 pl-3 pr-7 rounded-xl border border-zinc-200 bg-white text-[13px] text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 cursor-pointer"
              >
                <option value="user">User</option>
                <option value="tenant_admin">Admin</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-400 pointer-events-none" />
            </div>

            <Button
              type="submit"
              disabled={inviting || !inviteEmail}
              className="h-9 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white text-[13px] font-medium transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shrink-0"
            >
              {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
              Invite
            </Button>
          </div>

          {inviteError && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-600">
              <AlertCircle className="h-3 w-3 shrink-0" />{inviteError}
            </div>
          )}
          {inviteSuccess && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-600">
              <CheckCircle2 className="h-3 w-3 shrink-0" />{inviteSuccess}
            </div>
          )}
        </form>

        {/* Members list */}
        {loadingTeam ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 text-zinc-300 animate-spin" />
          </div>
        ) : (
          <div className="space-y-1.5">
            {members.map((member) => (
              <div key={member.id} className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3.5 py-2.5">
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center shrink-0">
                  <span className="text-[11px] font-semibold text-white uppercase">{member.email[0]}</span>
                </div>
                <p className="text-[13px] text-zinc-700 truncate flex-1" title={member.email}>{member.email}</p>
                <RoleBadge role={member.role} />
              </div>
            ))}

            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-200 bg-white px-3.5 py-2.5">
                <div className="h-7 w-7 rounded-full bg-zinc-100 flex items-center justify-center shrink-0">
                  <Mail className="h-3.5 w-3.5 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-zinc-500 truncate" title={invite.email}>{invite.email}</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">Invite sent · {new Date(invite.created_at).toLocaleDateString()}</p>
                </div>
                <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5">Pending</span>
                <button
                  type="button"
                  onClick={() => void handleCancelInvite(invite.id)}
                  disabled={cancellingInviteId === invite.id}
                  title="Cancel invite"
                  className="shrink-0 text-zinc-300 hover:text-red-500 transition-colors cursor-pointer disabled:opacity-40"
                >
                  {cancellingInviteId === invite.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}

            {members.length === 0 && pendingInvites.length === 0 && (
              <div className="text-center py-4 text-xs text-zinc-400">
                No team members yet — invite your first colleague above.
              </div>
            )}
          </div>
        )}
      </section>

      <div className="border-t border-zinc-100" />

      {/* ── YOUR KNOWLEDGE BASE ───────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="h-4 w-4 text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-800">Your Knowledge Base</h3>
        </div>
        <p className="text-xs text-zinc-500 mb-5 leading-relaxed">
          Upload PDF documents that your AI assistant can search and reference. These documents are private to your organization.
        </p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { label: "Documents", value: loadingDocs ? "—" : String(ownDocuments.length) },
            { label: "Ready",     value: loadingDocs ? "—" : String(ownReady) },
            { label: "Chunks",    value: loadingDocs ? "—" : String(ownChunks) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-center">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-0.5">{label}</p>
              <p className="text-xl font-bold text-zinc-900">{value}</p>
            </div>
          ))}
        </div>

        <Button
          onClick={() => { setShowUpload(true); setUploadError(null); }}
          disabled={uploading}
          className="w-full h-10 text-sm font-medium rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white transition-all cursor-pointer flex items-center gap-2 justify-center mb-4"
        >
          {uploading ? <><Loader2 className="h-4 w-4 animate-spin" />Processing...</> : <><Upload className="h-4 w-4" />Upload PDF</>}
        </Button>

        {uploadError && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-red-800">Upload failed</p>
              <p className="text-[11px] text-red-600 mt-0.5">{uploadError}</p>
            </div>
            <button onClick={() => setUploadError(null)} className="ml-auto shrink-0 text-red-400 hover:text-red-600 cursor-pointer">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Own docs list */}
        {loadingDocs ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 text-zinc-300 animate-spin" /></div>
        ) : ownDocuments.length === 0 ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-zinc-200">
            <BookOpen className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-zinc-500">No documents uploaded yet</p>
            <p className="text-xs text-zinc-400 mt-1">Upload a PDF to build your knowledge base.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ownDocuments.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                isShared={false}
                canManage={true}
                deletingId={deletingId}
                confirmDeleteId={confirmDeleteId}
                reprocessingId={reprocessingId}
                onDelete={(id) => void handleDelete(id)}
                onReprocess={(id) => void handleReprocess(id)}
                onConfirmDelete={setConfirmDeleteId}
              />
            ))}
          </div>
        )}
      </section>

      <div className="border-t border-zinc-100" />

      {/* ── SHARED KNOWLEDGE BASE ─────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <Globe className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-zinc-800">Shared Knowledge Base</h3>
          {isSharedAdmin ? (
            <span className="ml-auto text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 flex items-center gap-1">
              <Shield className="h-2.5 w-2.5" />Shared Admin
            </span>
          ) : (
            <span className="ml-auto text-[10px] text-zinc-400 uppercase tracking-wider font-semibold flex items-center gap-1">
              <Lock className="h-2.5 w-2.5" />Read-only
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mb-5 leading-relaxed">
          {isSharedAdmin
            ? "You are the Shared KB administrator. Documents uploaded here are searchable by all users across every tenant."
            : "These enterprise-wide documents are managed by the Shared Admin and are available to all users across every tenant."}
        </p>

        {/* Shared stats */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          {[
            { label: "Shared Docs", value: loadingDocs ? "—" : String(sharedDocuments.length) },
            { label: "Ready",       value: loadingDocs ? "—" : String(sharedReady) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2.5 text-center">
              <p className="text-[10px] text-amber-600 uppercase tracking-wider font-medium mb-0.5">{label}</p>
              <p className="text-xl font-bold text-zinc-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Upload to shared — only for shared_admin */}
        {isSharedAdmin && (
          <>
            <Button
              onClick={() => { setShowUploadShared(true); setUploadErrorShared(null); }}
              disabled={uploadingShared}
              className="w-full h-10 text-sm font-medium rounded-xl bg-amber-600 hover:bg-amber-700 text-white transition-all cursor-pointer flex items-center gap-2 justify-center mb-4"
            >
              {uploadingShared
                ? <><Loader2 className="h-4 w-4 animate-spin" />Processing...</>
                : <><Upload className="h-4 w-4" />Upload to Shared KB</>}
            </Button>

            {uploadErrorShared && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-800">Upload failed</p>
                  <p className="text-[11px] text-red-600 mt-0.5">{uploadErrorShared}</p>
                </div>
                <button onClick={() => setUploadErrorShared(null)} className="ml-auto shrink-0 text-red-400 hover:text-red-600 cursor-pointer">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </>
        )}

        {/* Shared docs list */}
        {loadingDocs ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 text-zinc-300 animate-spin" /></div>
        ) : sharedDocuments.length === 0 ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-amber-200">
            <Globe className="h-8 w-8 text-amber-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-zinc-500">No shared documents yet</p>
            <p className="text-xs text-zinc-400 mt-1">
              {isSharedAdmin
                ? "Upload a PDF above to add to the enterprise shared knowledge base."
                : "The Shared Admin has not uploaded any documents yet."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sharedDocuments.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                isShared={true}
                canManage={isSharedAdmin}
                deletingId={deletingId}
                confirmDeleteId={confirmDeleteId}
                reprocessingId={reprocessingId}
                onDelete={(id) => void handleDelete(id)}
                onReprocess={(id) => void handleReprocess(id)}
                onConfirmDelete={setConfirmDeleteId}
              />
            ))}
          </div>
        )}
      </section>

      {/* Own KB upload modal */}
      {showUpload && (
        <PdfUpload onParsed={(r) => void handlePdfParsed(r, "own")} onClose={() => setShowUpload(false)} />
      )}

      {/* Shared KB upload modal */}
      {showUploadShared && (
        <PdfUpload onParsed={(r) => void handlePdfParsed(r, "shared")} onClose={() => setShowUploadShared(false)} />
      )}
    </div>
  );
}
