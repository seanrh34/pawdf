// Retrieval for documents too large to fit in the model's context.
//
// Extracted text arrives as "[Page N]\n…" blocks joined by blank lines (see
// extractText in main.js). Everything here preserves those markers: each chunk
// carries its own [Page N] header, so a citation can never be attributed to the
// wrong page just because the chunk boundary fell between markers.

const STOP = new Set(
  ("a an and are as at be been being by for from has have had he in is it its of on or that the " +
    "their there these this those to was were will with you your " +
    // question / instruction words: rare inside a contract, so IDF would rank
    // them as highly informative if they were left in
    "what which who whom whose how when where why does do did can could would should shall may " +
    "tell me about please explain describe give show find say list summarise summarize " +
    "any all under upon such than then").split(" "),
);

const MIN_HITS = 10; // chunks kept regardless of the relative floor below

// Words as [a-z]{2,}; numbers keep their dotted form so contract references like
// "12.3" survive as a single, highly distinctive token.
const TOK = /[a-z]{2,}|\d+(?:\.\d+)*/g;

// Crude suffix stripping, not real linguistics. People ask "which law governs
// this agreement" about a clause that reads "governed by the laws of" — without
// this, "law"/"laws" and "governs"/"governed" are unrelated tokens and the
// clause is never found. Correctness doesn't matter here, only that the query
// and the document are folded the same way, so over-stemming is harmless.
// Numbers are left alone: "12.3" is the most locating token a contract has.
function stem(w) {
  if (/\d/.test(w) || w.length <= 3) return w;
  const out = w
    .replace(/ies$/, "i")
    .replace(/([^s])s$/, "$1")
    .replace(/tion$/, "t")
    .replace(/(ing|edly|ed|ly)$/, "")
    .replace(/e$/, "");
  return out.length >= 3 ? out : w;
}

const tokenize = (s) =>
  (s.toLowerCase().match(TOK) || []).filter((t) => !STOP.has(t)).map(stem);

// Chunk on page boundaries, packing whole sentences/clauses up to `target`
// chars. Splitting on [.;:] keeps numbered contract clauses intact.
export function chunkDoc(text, target = 1200) {
  const chunks = [];
  for (const block of text.split(/\n\n(?=\[Page \d+\])/)) {
    const m = block.match(/^\[Page (\d+)\]\n?/);
    const page = m ? Number(m[1]) : 0;
    const body = (m ? block.slice(m[0].length) : block).trim();
    if (!body) continue;
    let buf = "";
    const flush = () => {
      if (buf.trim()) chunks.push({ page, text: `[Page ${page}]\n${buf.trim()}` });
      buf = "";
    };
    for (const part of body.split(/(?<=[.;:])\s+|\n+/)) {
      if (buf && buf.length + part.length > target) flush();
      buf += (buf ? " " : "") + part;
    }
    flush();
  }
  for (const c of chunks) {
    c.toks = tokenize(c.text);
    c.tf = new Map();
    for (const t of c.toks) c.tf.set(t, (c.tf.get(t) || 0) + 1);
  }
  return chunks;
}

// Okapi BM25. Beats raw term counts on contracts specifically: it discounts the
// boilerplate every clause repeats ("agreement", "party", "shall") and rewards
// the rare term that actually locates the clause ("indemnity", "12.3").
function score(chunks, terms) {
  const N = chunks.length;
  if (!N) return;
  const avg = chunks.reduce((s, c) => s + c.toks.length, 0) / N || 1;
  const df = new Map();
  for (const c of chunks) for (const t of new Set(c.toks)) df.set(t, (df.get(t) || 0) + 1);
  const k1 = 1.5;
  const b = 0.75;
  for (const c of chunks) {
    let s = 0;
    for (const q of terms) {
      const f = c.tf.get(q);
      if (!f) continue;
      const n = df.get(q);
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.toks.length) / avg)));
    }
    c.score = s;
  }
}

function assemble(chunks, picked) {
  const idx = [...picked].sort((a, b) => a - b);
  let out = "";
  for (let k = 0; k < idx.length; k++) {
    if (k) out += idx[k] === idx[k - 1] + 1 ? "\n" : "\n[…]\n";
    out += chunks[idx[k]].text;
  }
  return out;
}

// Returns { context, matched, coverage }. `matched` is the relevance floor: if
// no chunk scores above zero the question has no lexical footing in the
// document, and the caller tells the model so rather than letting it answer
// from whatever happened to be at the front.
export function pickContext(text, query, budget, prevQuery = "") {
  if (text.length <= budget) return { context: text, matched: true, coverage: 1 };
  const chunks = chunkDoc(text);
  const picked = new Set();
  let used = 0;

  // Head: parties, dates, recitals and usually the definitions block. Contract
  // questions lean on these constantly, and keeping it first and fixed gives
  // llama.cpp's prompt cache a stable prefix to reuse between questions.
  const headBudget = Math.min(6000, Math.floor(budget * 0.25));
  for (let i = 0; i < chunks.length; i++) {
    if (used + chunks[i].text.length > headBudget) break;
    picked.add(i);
    used += chunks[i].text.length;
  }

  score(chunks, tokenize(`${query} ${prevQuery}`));
  let ranked = chunks
    .map((c, i) => ({ i, s: c.score }))
    .filter((o) => o.s > 0)
    .sort((a, b) => b.s - a.s);

  // Relative floor. A word like "parties" or "law" occurs on every page of a
  // contract, so "score > 0" alone happily fills the whole budget with chunks
  // that share one common term with the question — slower to prefill and more
  // for the model to sift. Keep the strong matches (and always at least
  // MIN_HITS, so a question that genuinely spans many clauses still gets them).
  if (ranked.length) {
    const cut = ranked[0].s * 0.25;
    ranked = ranked.filter((o, n) => n < MIN_HITS || o.s >= cut);
  }

  for (const { i } of ranked) {
    if (used >= budget) break;
    // neighbours too: a clause and its carve-outs routinely straddle a boundary
    for (const j of [i, i - 1, i + 1]) {
      if (j < 0 || j >= chunks.length || picked.has(j)) continue;
      if (used + chunks[j].text.length > budget) continue;
      picked.add(j);
      used += chunks[j].text.length;
    }
  }
  return { context: assemble(chunks, picked), matched: ranked.length > 0, coverage: used / text.length };
}

// Summaries have no query to rank against. Sampling evenly across the document
// describes the whole contract; ranking by "summary overview" (the old
// behaviour) just returned the opening pages.
export function pickIntro(text, budget) {
  if (text.length <= budget) return text;
  const chunks = chunkDoc(text);
  const avg = chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length || 1;
  const want = Math.max(1, Math.floor(budget / avg));
  const picked = new Set();
  const step = chunks.length / want;
  for (let k = 0; k < want; k++) picked.add(Math.min(chunks.length - 1, Math.round(k * step)));
  return assemble(chunks, picked);
}
