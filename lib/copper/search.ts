// Searching the company documents. The question is embedded (turned into a
// list of numbers), then compared with every passage's embedding. The
// passages whose numbers point the same way are the ones closest in meaning.
import { callEmbed } from "@/lib/ai/call";
import { DOCUMENTS } from "@/lib/copper/documents";
import { PASSAGES, type Passage } from "@/lib/copper/passages";

export type SearchResult = {
  documentId: string;
  /** Document title, to cite. */
  title: string;
  /** 1-based page number, to cite. */
  page: number;
  /** The passage itself, without the title it was embedded with. */
  text: string;
  /** Link to that page of the PDF. */
  url: string;
  /** Cosine similarity, 0 to 1: higher is a closer match. */
  score: number;
};

/** How many passages a search returns. */
export const TOP_K = 5;

/** Cosine similarity of two same-length vectors. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/** The `k` passages closest to an already-embedded question, best first. */
export function rankPassages(
  queryEmbedding: readonly number[],
  passages: readonly Passage[] = PASSAGES,
  k = TOP_K,
): SearchResult[] {
  return passages
    .map((passage) => ({
      passage,
      score: cosine(queryEmbedding, passage.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ passage, score }) => {
      const file = DOCUMENTS.find((d) => d.id === passage.documentId)?.file;
      return {
        documentId: passage.documentId,
        title: passage.title,
        page: passage.page,
        text: passage.text.startsWith(`${passage.title}. `)
          ? passage.text.slice(passage.title.length + 2)
          : passage.text,
        url: file ? `${file}#page=${passage.page}` : "",
        score: Math.round(score * 1000) / 1000,
      };
    });
}

/** Embeds the question and returns the closest passages. */
export async function searchDocuments(query: string): Promise<SearchResult[]> {
  const embedding = await callEmbed(
    { module: 3, feature: "document-search" },
    query,
    "RETRIEVAL_QUERY",
  );
  return rankPassages(embedding);
}
