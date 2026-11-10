// Document search: the passages file is well formed, and ranking finds the
// closest passage. No AI key needed: the question's embedding is made up.
import { describe, expect, it } from "vitest";
import { DOCUMENTS } from "@/lib/copper/documents";
import { EMBEDDING_MODEL, PASSAGES, type Passage } from "@/lib/copper/passages";
import { cosine, rankPassages } from "@/lib/copper/search";

const passage = (id: string, embedding: number[]): Passage => ({
  id,
  documentId: "copper-plus-faq",
  title: "Copper Plus FAQ",
  page: 2,
  text: `Copper Plus FAQ. Text of ${id}.`,
  embedding,
});

describe("cosine and rankPassages", () => {
  it("scores same direction 1, opposite -1, unrelated 0", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("returns the closest passages first, with the title stripped from the text", () => {
    const passages = [
      passage("far", [0, 1]),
      passage("near", [1, 0.1]),
      passage("middle", [1, 1]),
    ];
    const results = rankPassages([1, 0], passages, 2);
    expect(results.map((r) => r.text)).toEqual([
      "Text of near.",
      "Text of middle.",
    ]);
    expect(results[0]).toMatchObject({
      title: "Copper Plus FAQ",
      page: 2,
      url: "/docs/copper-plus-faq.pdf#page=2",
    });
  });
});

describe("the embedded passages", () => {
  it("covers every document, each passage keeps its title and page, and starts with the title", () => {
    expect(PASSAGES.length).toBeGreaterThan(0);
    for (const doc of DOCUMENTS) {
      const mine = PASSAGES.filter((p) => p.documentId === doc.id);
      expect(mine.length, doc.title).toBeGreaterThan(0);
      for (const p of mine) {
        expect(p.title).toBe(doc.title);
        expect(p.page).toBeGreaterThanOrEqual(1);
        expect(p.text.startsWith(`${doc.title}. `)).toBe(true);
      }
    }
  });

  it("gives every passage an embedding of the same length", () => {
    expect(EMBEDDING_MODEL).toBeTruthy();
    const length = PASSAGES[0].embedding.length;
    expect(length).toBeGreaterThan(0);
    expect(PASSAGES.every((p) => p.embedding.length === length)).toBe(true);
  });

  it("finds a passage when asked with its own embedding", () => {
    const target = PASSAGES[40];
    const [best] = rankPassages(target.embedding);
    expect(best.title).toBe(target.title);
    expect(best.page).toBe(target.page);
    expect(best.score).toBeGreaterThan(0.99);
  });
});
