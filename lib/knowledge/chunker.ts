export interface TextChunk {
  chunkIndex: number;
  chunkText: string;
  /** Extensible metadata: page numbers, section titles, etc. go here */
  metadata: Record<string, unknown>;
}

/** Default chunk size in characters (~200 words) */
const DEFAULT_CHUNK_SIZE = 800;

/** Overlap between consecutive chunks to preserve context at boundaries */
const DEFAULT_OVERLAP = 100;

/**
 * Splits a large text into overlapping fixed-size chunks.
 *
 * Design is intentionally simple so it can be swapped for a semantic
 * splitter (sentence-aware, section-aware, etc.) later without changing
 * the downstream interface.
 */
export function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP
): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < trimmed.length) {
    const end = Math.min(start + chunkSize, trimmed.length);
    const slice = trimmed.slice(start, end).trim();

    if (slice.length > 0) {
      chunks.push({
        chunkIndex: index++,
        chunkText: slice,
        metadata: {},
      });
    }

    if (end >= trimmed.length) break;
    start = end - overlap;
  }

  return chunks;
}
