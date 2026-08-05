import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, checkRole, checkSharedAdmin } from "@/lib/rbac";
import { chunkText } from "@/lib/knowledge/chunker";
import { SHARED_TENANT_ID } from "@/types";

// ── DELETE /api/kb/documents/[id] ────────────────────────────
// Admin-only. Deletes the document; chunks cascade via FK.
// Extra guard: if the document is in the shared tenant, only shared_admin
// may delete it. Regular tenant admins get a 403.

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const ctx = await getTenantContext(supabase);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deny = checkRole(ctx, "admin");
    if (deny) return deny;

    // Load the document to determine which tenant it belongs to
    const { data: doc, error: loadError } = await supabase
      .from("documents")
      .select("id, tenant_id")
      .eq("id", id)
      .single();

    if (loadError || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // If it's a shared-tenant document, require shared_admin
    if (doc.tenant_id === SHARED_TENANT_ID) {
      const sharedDeny = checkSharedAdmin(ctx);
      if (sharedDeny) return sharedDeny;
    } else {
      // Belt-and-suspenders: regular doc must belong to caller's tenant
      if (doc.tenant_id !== ctx.tenantId) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
    }

    const { error } = await supabase
      .from("documents")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/kb/documents/[id] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST /api/kb/documents/[id] ──────────────────────────────
// Admin-only. Body: { action: "reprocess" }
// Re-chunks the stored extracted_text and replaces all existing chunks.
// Extra guard: shared-tenant documents require shared_admin.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const ctx = await getTenantContext(supabase);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deny = checkRole(ctx, "admin");
    if (deny) return deny;

    const body = (await request.json()) as { action: string };
    if (body.action !== "reprocess") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    // Load the document (RLS SELECT allows seeing shared docs for everyone)
    const { data: doc, error: loadError } = await supabase
      .from("documents")
      .select("id, extracted_text, tenant_id")
      .eq("id", id)
      .single();

    if (loadError || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // If it's a shared document, only shared_admin may reprocess
    if (doc.tenant_id === SHARED_TENANT_ID) {
      const sharedDeny = checkSharedAdmin(ctx);
      if (sharedDeny) return sharedDeny;
    } else {
      // Regular doc must belong to caller's tenant
      if (doc.tenant_id !== ctx.tenantId) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
    }

    if (!doc.extracted_text) {
      return NextResponse.json(
        { error: "No stored text available for re-processing" },
        { status: 422 }
      );
    }

    // Mark as processing
    await supabase
      .from("documents")
      .update({ processing_status: "processing", chunk_count: 0 })
      .eq("id", id);

    // Delete old chunks
    await supabase.from("document_chunks").delete().eq("document_id", id);

    // Re-chunk
    const chunks = chunkText(doc.extracted_text as string);

    if (chunks.length === 0) {
      await supabase
        .from("documents")
        .update({ processing_status: "error", error_message: "Re-chunking produced no results" })
        .eq("id", id);
      return NextResponse.json(
        { error: "Re-chunking produced no results" },
        { status: 422 }
      );
    }

    const chunkRows = chunks.map((c) => ({
      tenant_id: doc.tenant_id, // preserve original tenant (own or shared)
      document_id: id,
      chunk_index: c.chunkIndex,
      chunk_text: c.chunkText,
      metadata: c.metadata,
    }));

    const { error: chunksError } = await supabase
      .from("document_chunks")
      .insert(chunkRows);

    if (chunksError) throw chunksError;

    const { data: updatedDoc, error: updateError } = await supabase
      .from("documents")
      .update({ processing_status: "done", chunk_count: chunks.length })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({
      document: {
        ...updatedDoc,
        is_shared_doc: doc.tenant_id === SHARED_TENANT_ID,
      },
    });
  } catch (err) {
    console.error("POST /api/kb/documents/[id] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
