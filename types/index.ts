// ── Shared Tenant ─────────────────────────────────────────────
/** Fixed UUID for the singleton Shared Knowledge Base tenant. */
export const SHARED_TENANT_ID = "00000000-0000-0000-0000-000000000001" as const;

export type ChatThread = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
};

export type ChatMessage = {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  created_at: string;
};

export type ModelOption = {
  id: string;
  name: string;
  provider?: string;
  last_verified_at?: string;
};

// ── RBAC ──────────────────────────────────────────────────────

/**
 * Explicit 3-level role system.
 *
 * - user          → read-only tenant member
 * - tenant_admin  → manages own tenant KB and members (was 'admin')
 * - shared_admin  → manages the shared KB; manually assigned only
 */
export type UserRole = "user" | "tenant_admin" | "shared_admin";

export interface TenantContext {
  userId: string;
  /** The user's own personal tenant (never the shared tenant UUID). */
  tenantId: string;
  role: UserRole;
  /** True when role === 'shared_admin'. Convenience shorthand. */
  isSharedAdmin: boolean;
}

// ── Knowledge Base ────────────────────────────────────────────

export type DocumentStatus = "pending" | "processing" | "done" | "error";

export interface KBDocument {
  id: string;
  tenant_id: string;
  filename: string;
  uploaded_by: string;
  upload_date: string;
  processing_status: DocumentStatus;
  chunk_count: number;
  file_size_bytes: number | null;
  error_message: string | null;
  /** Uploader email joined from profiles */
  profiles?: { email: string } | null;
  /** True when this document belongs to the shared tenant. */
  is_shared_doc?: boolean;
}

export interface KBChunk {
  id: string;
  chunk_text: string;
  chunk_index: number;
  document_id: string;
  filename: string;
  metadata: Record<string, unknown>;
  /** Whether this chunk came from the user's own KB or the shared KB. */
  source?: "own" | "shared";
}
