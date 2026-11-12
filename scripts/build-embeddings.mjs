// Builds lib/copper/data/passages.json from the PDFs in public/docs.
//
//   npm run build-embeddings
//
// 1. Reads every document listed in lib/copper/documents.ts.
// 2. Pulls the text out of each page and drops the repeated page header.
// 3. Splits each page into passages of a few sentences.
// 4. Starts each passage's text with its document title, so the title travels
//    with the passage when it is embedded.
// 5. Embeds every passage with Gemini and writes one JSON file.
//
// Needs GOOGLE_GENERATIVE_AI_API_KEY (the npm script reads .env.local).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractText, getDocumentProxy } from "unpdf";
import { DOCUMENTS } from "../lib/copper/documents.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "lib/copper/data/passages.json");
const MODEL = "gemini-embedding-001";
const DIMENSIONS = 768;
const SENTENCES_PER_PASSAGE = 3;
const MAX_PASSAGE_CHARS = 700;
const MIN_PASSAGE_CHARS = 60;
const BATCH_SIZE = 50;

const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
if (!key) {
  console.error("Missing GOOGLE_GENERATIVE_AI_API_KEY. Add it to .env.local.");
  process.exit(1);
}

/** Drops the header every page repeats: title line, document ID line, copyright line. */
function stripHeader(pageText) {
  const lines = pageText.split("\n");
  const copyright = lines.findIndex(
    (line, i) => i < 6 && /^©\s*\d{4}\s+Copper State Labs/.test(line.trim()),
  );
  return (copyright === -1 ? lines : lines.slice(copyright + 1)).join("\n");
}

/** Splits one page's text into passages of a few sentences each. */
function toPassages(pageText) {
  const flat = stripHeader(pageText)
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+•\s*/g, " • ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return [];

  const sentences = flat
    .split(/(?<=[.!?])\s+(?=[A-Z0-9•"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const passages = [];
  let current = [];
  const flush = () => {
    if (current.length) passages.push(current.join(" "));
    current = [];
  };
  for (const sentence of sentences) {
    const length = current.join(" ").length + sentence.length + 1;
    if (current.length && length > MAX_PASSAGE_CHARS) flush();
    current.push(sentence);
    if (current.length >= SENTENCES_PER_PASSAGE) flush();
  }
  flush();

  // A tiny leftover joins the passage before it.
  if (passages.length > 1 && passages.at(-1).length < MIN_PASSAGE_CHARS) {
    const tail = passages.pop();
    passages[passages.length - 1] += ` ${tail}`;
  }
  return passages;
}

const MAX_RETRIES = 6;

/** Embeds a batch. On the free tier's per-minute limit (429), waits and retries. */
async function embedBatch(texts, attempt = 0) {
  const response = await fetchBatch(texts);
  if (response.status === 429 && attempt < MAX_RETRIES) {
    const body = await response.json().catch(() => ({}));
    // Google says how long to wait: "Please retry in 7.35s."
    const said = /retry in ([\d.]+)s/i.exec(body.error?.message ?? "");
    const seconds = Math.min(65, (said ? Number(said[1]) : 15) + 2);
    console.log(
      `Rate limit reached. Waiting ${Math.ceil(seconds)}s, then trying again…`,
    );
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return embedBatch(texts, attempt + 1);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      `Embedding request failed (${response.status}): ${body.error?.message ?? "no message"}`,
    );
  }
  const { embeddings } = await response.json();
  return embeddings.map((e) => e.values.map((v) => Number(v.toFixed(6))));
}

function fetchBatch(texts) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${MODEL}`,
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: DIMENSIONS,
        })),
      }),
    },
  );
}

const passages = [];
for (const doc of DOCUMENTS) {
  const bytes = new Uint8Array(readFileSync(join(ROOT, "public", doc.file)));
  const pdf = await getDocumentProxy(bytes);
  const { text: pages } = await extractText(pdf, { mergePages: false });
  pages.forEach((pageText, index) => {
    toPassages(pageText).forEach((passage, n) => {
      passages.push({
        id: `${doc.id}-p${index + 1}-${n + 1}`,
        documentId: doc.id,
        title: doc.title,
        page: index + 1,
        // Starts with the document title, as the embedding input.
        text: `${doc.title}. ${passage}`,
      });
    });
  });
}

for (let i = 0; i < passages.length; i += BATCH_SIZE) {
  const batch = passages.slice(i, i + BATCH_SIZE);
  const vectors = await embedBatch(batch.map((p) => p.text));
  batch.forEach((p, j) => {
    p.embedding = vectors[j];
  });
  console.log(
    `Embedded ${Math.min(i + BATCH_SIZE, passages.length)} / ${passages.length}`,
  );
}

writeFileSync(
  OUT,
  JSON.stringify({
    model: MODEL,
    dimensions: DIMENSIONS,
    createdAt: new Date().toISOString(),
    passages,
  }),
);

console.log(
  `\nSaved ${passages.length} passages to lib/copper/data/passages.json\n`,
);
for (const doc of DOCUMENTS) {
  const count = passages.filter((p) => p.documentId === doc.id).length;
  console.log(`${doc.title}: ${count}`);
}
