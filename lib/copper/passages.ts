// The company documents, split into passages and embedded by
// `npm run build-embeddings`. The JSON is imported once, so it is loaded into
// memory when the server starts and every request reuses it.
import data from "@/lib/copper/data/passages.json";

export type Passage = {
  id: string;
  documentId: string;
  /** Document title. */
  title: string;
  /** 1-based PDF page number. */
  page: number;
  /** Starts with the document title. This is the text that was embedded. */
  text: string;
  embedding: number[];
};

export const EMBEDDING_MODEL: string = data.model;
export const PASSAGES: readonly Passage[] = data.passages;
