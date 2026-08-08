import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, checkRole, checkSharedAdmin } from "@/lib/rbac";
import { chunkText } from "@/lib/knowledge/chunker";
import type { KBDocument } from "@/types";
import { SHARED_TENANT_ID } from "@/types";

// ── GET /api/kb/documents ─────────────────────────────────────
// Returns all documents for the authenticated user's tenant.
// RLS SELECT policy now also exposes shared-tenant documents,
// so we get both in one query. We tag each with is_shared_doc.

export async function GET() {
  try {
    const supabase = await createClient();
    const ctx = await getTenantContext(supabase);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch own-tenant docs
    const { data: ownDocs, error: ownError } = await supabase
      .from("documents")
      .select(
        "id, tenant_id, filename, uploaded_by, upload_date, processing_status, chunk_count, file_size_bytes, error_message, profiles!uploaded_by ( email )"
      )
      .eq("tenant_id", ctx.tenantId)
      .order("upload_date", { ascending: false });

    if (ownError) throw ownError;

    // Fetch shared-tenant docs (RLS allows SELECT for everyone)
    const { data: sharedDocs, error: sharedError } = await supabase
      .from("documents")
      .select(
        "id, tenant_id, filename, uploaded_by, upload_date, processing_status, chunk_count, file_size_bytes, error_message, profiles!uploaded_by ( email )"
      )
      .eq("tenant_id", SHARED_TENANT_ID)
      .order("upload_date", { ascending: false });

    if (sharedError) {
      // Shared tenant may have no documents yet — not a fatal error
      console.warn("GET shared docs:", sharedError.message);
    }

    const taggedOwn = (ownDocs ?? []).map((d: Record<string, unknown>) => ({
      ...d,
      is_shared_doc: false,
    }));

    const taggedShared = (sharedDocs ?? []).map((d: Record<string, unknown>) => ({
      ...d,
      is_shared_doc: true,
    }));

    return NextResponse.json({
      documents: [...taggedOwn, ...taggedShared] as KBDocument[],
    });
  } catch (err) {
    console.error("GET /api/kb/documents error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST /api/kb/documents ────────────────────────────────────
// Admin-only: create a document record + run ingestion pipeline inline.
// Body: { filename, extractedText, fileSizeBytes?, target?: 'shared' }
//
// target = 'shared' → requires shared_admin role, inserts into shared tenant.
// target = 'own' (or omitted) → requires tenant_admin+, inserts into own tenant.

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const ctx = await getTenantContext(supabase);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Any admin can reach this route
    const deny = checkRole(ctx, "admin");
    if (deny) return deny;

    const body = (await request.json()) as {
      filename: string;
      extractedText: string;
      fileSizeBytes?: number;
      target?: "shared" | "own";
    };

    const { filename, extractedText, fileSizeBytes, target } = body;

    if (!filename || !extractedText) {
      return NextResponse.json(
        { error: "filename and extractedText are required" },
        { status: 400 }
      );
    }

    // Determine target tenant
    const isSharedTarget = target === "shared";

    if (isSharedTarget) {
      // Only shared_admin may upload to the shared knowledge base
      const sharedDeny = checkSharedAdmin(ctx);
      if (sharedDeny) return sharedDeny;
    }

    const targetTenantId = isSharedTarget ? SHARED_TENANT_ID : ctx.tenantId;

    // ── Step 0: Calculate content hash and check for duplicates
    const crypto = await import("crypto");
    const contentHash = crypto.createHash("sha256").update(extractedText).digest("hex");

    const { data: existingDoc } = await supabase
      .from("documents")
      .select("id")
      .eq("tenant_id", targetTenantId)
      .eq("content_hash", contentHash)
      .single();

    if (existingDoc) {
      return NextResponse.json(
        { error: "Duplicate document. This content has already been uploaded." },
        { status: 409 }
      );
    }

    // ── Step 1: Create the document record ────────────────────
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({
        tenant_id: targetTenantId,
        filename,
        uploaded_by: ctx.userId,
        processing_status: "processing",
        file_size_bytes: fileSizeBytes ?? null,
        extracted_text: extractedText,
        content_hash: contentHash,
      })
      .select()
      .single();

    if (docError) {
      // Handle race condition uniqueness violation (Postgres error code 23505)
      if (docError.code === "23505") {
        return NextResponse.json(
          { error: "Duplicate document. This content has already been uploaded." },
          { status: 409 }
        );
      }
      throw new Error(docError.message ?? "Failed to create document record");
    }

    if (!doc) throw new Error("Failed to create document record");

    // ── Step 2: Chunk the extracted text ──────────────────────
    const chunks = chunkText(extractedText);

    if (chunks.length === 0) {
      await supabase
        .from("documents")
        .update({ processing_status: "error", error_message: "No text could be chunked" })
        .eq("id", doc.id);
      return NextResponse.json(
        { error: "No text could be extracted from document" },
        { status: 422 }
      );
    }

    // ── Step 3: Insert chunks ─────────────────────────────────
    const chunkRows = chunks.map((c) => ({
      tenant_id: targetTenantId,
      document_id: doc.id,
      chunk_index: c.chunkIndex,
      chunk_text: c.chunkText,
      metadata: c.metadata,
    }));

    const { error: chunksError } = await supabase
      .from("document_chunks")
      .insert(chunkRows);

    if (chunksError) throw chunksError;

    // ── Step 4: Update document status ────────────────────────
    const { data: updatedDoc, error: updateError } = await supabase
      .from("documents")
      .update({ processing_status: "done", chunk_count: chunks.length })
      .eq("id", doc.id)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({ document: { ...updatedDoc, is_shared_doc: isSharedTarget } }, { status: 201 });
  } catch (err) {
    console.error("POST /api/kb/documents error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
