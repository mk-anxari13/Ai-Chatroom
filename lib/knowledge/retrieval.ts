import type { SupabaseClient } from "@supabase/supabase-js";
import type { KBChunk } from "@/types";
import { SHARED_TENANT_ID } from "@/types";

export interface RetrievalResult {
  chunks: KBChunk[];
  query: string;
  tenantId: string;
}

/**
 * Searches ONE tenant's knowledge base for chunks relevant to a query.
 *
 * CURRENT IMPLEMENTATION: PostgreSQL ILIKE full-text search.
 * FUTURE SWAP: Replace the body with pgvector similarity search
 * without changing the function signature.
 *
 * Security: tenantId MUST come from the server-side TenantContext,
 * never from client input.
 */
export async function searchKnowledgeBase(
  supabase: SupabaseClient,
  tenantId: string,
  query: string,
  limit = 5
): Promise<RetrievalResult> {
  if (!query.trim()) {
    return { chunks: [], query, tenantId };
  }

  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 8);

  if (terms.length === 0) {
    return { chunks: [], query, tenantId };
  }

  const orQuery = terms.map(t => `chunk_text.ilike.%${t}%`).join(",");

  const { data, error } = await supabase
    .from("document_chunks")
    .select(
      `id, chunk_text, chunk_index, document_id, metadata,
       documents!inner ( filename, tenant_id )`
    )
    .eq("tenant_id", tenantId)
    .or(orQuery)
    .limit(limit);

  if (error || !data) {
    console.error("KB retrieval error:", error);
    return { chunks: [], query, tenantId };
  }

  const chunks: KBChunk[] = mapChunkRows(data, "own");

  return { chunks, query, tenantId };
}

/**
 * Searches BOTH the user's own tenant KB and the Shared Knowledge Base,
 * merges results (own-tenant chunks first), and returns up to `limit` chunks.
 *
 * - Own-tenant chunks are tagged  source: 'own'
 * - Shared-tenant chunks are tagged source: 'shared'
 *
 * If the calling user IS the shared tenant admin their tenantId may equal
 * SHARED_TENANT_ID; in that case only one query is run (no double-fetch).
 *
 * Security: both tenantId and SHARED_TENANT_ID are server-controlled constants.
 */
export async function searchKnowledgeBaseWithShared(
  supabase: SupabaseClient,
  tenantId: string,
  query: string,
  limit = 8
): Promise<RetrievalResult> {
  if (!query.trim()) {
    return { chunks: [], query, tenantId };
  }

  const terms = query.trim().split(/\s+/).filter((t) => t.length > 2);
  if (terms.length === 0) {
    return { chunks: [], query, tenantId };
  }

  // Build an OR query for all terms to improve matching
  const orQuery = terms.map(t => `chunk_text.ilike.%${t}%`).join(",");

  // ── Query 1: own tenant ────────────────────────────────────
  const ownPromise = supabase
    .from("document_chunks")
    .select(
      `id, chunk_text, chunk_index, document_id, metadata,
       documents!inner ( filename, tenant_id )`
    )
    .eq("tenant_id", tenantId)
    .or(orQuery)
    .limit(Math.ceil(limit * 0.6)); // bias towards own-tenant results

  // ── Query 2: shared tenant (skip if user IS the shared tenant) ─
  const sharedPromise =
    tenantId === SHARED_TENANT_ID
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from("document_chunks")
          .select(
            `id, chunk_text, chunk_index, document_id, metadata,
             documents!inner ( filename, tenant_id )`
          )
          .eq("tenant_id", SHARED_TENANT_ID)
          .or(orQuery)
          .limit(Math.ceil(limit * 0.6));

  const [ownResult, sharedResult] = await Promise.all([ownPromise, sharedPromise]);

  if (ownResult.error) {
    console.error("KB retrieval error (own):", ownResult.error);
  }
  if (sharedResult.error) {
    console.error("KB retrieval error (shared):", sharedResult.error);
  }

  const ownChunks: KBChunk[] = mapChunkRows(ownResult.data ?? [], "own");
  const sharedChunks: KBChunk[] = mapChunkRows(sharedResult.data ?? [], "shared");

  // Merge: own first, then shared; deduplicate by chunk id
  const seen = new Set<string>();
  const merged: KBChunk[] = [];

  for (const chunk of [...ownChunks, ...sharedChunks]) {
    if (!seen.has(chunk.id)) {
      seen.add(chunk.id);
      merged.push(chunk);
      if (merged.length >= limit) break;
    }
  }

  return { chunks: merged, query, tenantId };
}

// ── Internal helpers ──────────────────────────────────────────

type RawChunkRow = {
  id: string;
  chunk_text: string;
  chunk_index: number;
  document_id: string;
  metadata: Record<string, unknown>;
  documents:
    | Array<{ filename: string; tenant_id: string }>
    | { filename: string; tenant_id: string }
    | null;
};

function mapChunkRows(
  rows: unknown[],
  source: "own" | "shared"
): KBChunk[] {
  return (rows as RawChunkRow[]).map((row) => {
    const docInfo = Array.isArray(row.documents) ? row.documents[0] : row.documents;
    return {
      id: row.id,
      chunk_text: row.chunk_text,
      chunk_index: row.chunk_index,
      document_id: row.document_id,
      filename: docInfo?.filename ?? "Unknown",
      metadata: row.metadata ?? {},
      source,
    };
  });
}
