// Pure helper for maintaining a bucket's running-average chunk length (token
// count), used for BM25 document-mode length normalization (D-10/D-11). Kept
// dependency-free (no Qdrant, no DB) so it is trivially unit-testable and can
// be called both at ingest time (buckets.ts) and from a future reindex path.

/**
 * Weighted running average: folds `newChunkTokenLengths` into a prior average
 * computed over `prevCount` chunks. When `prevCount` is 0 (fresh bucket), the
 * result is simply the mean of the new lengths. Ingesting zero new chunks
 * leaves the average unchanged.
 */
export function nextAvgChunkLength(
  prevAvg: number,
  prevCount: number,
  newChunkTokenLengths: number[],
): number {
  if (newChunkTokenLengths.length === 0) return prevAvg;
  const priorTotal = prevAvg * prevCount;
  const newTotal = newChunkTokenLengths.reduce((sum, len) => sum + len, 0);
  const totalCount = prevCount + newChunkTokenLengths.length;
  return (priorTotal + newTotal) / totalCount;
}
