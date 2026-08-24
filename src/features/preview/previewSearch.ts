export type PreviewSearchDirection = "next" | "previous";

export function previewTextMatches(text: string | null, query: string) {
  if (!text || query.length === 0) return false;
  return text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export function nextPreviewSearchIndex(
  currentIndex: number,
  matchCount: number,
  direction: PreviewSearchDirection,
) {
  if (matchCount === 0) return -1;
  if (direction === "next") return (currentIndex + 1 + matchCount) % matchCount;
  return (currentIndex - 1 + matchCount) % matchCount;
}
