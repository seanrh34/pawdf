// Self-check for retrieval: node src/retrieve.test.mjs
import assert from "node:assert/strict";
import { chunkDoc, pickContext, pickIntro } from "./retrieve.js";
import { linkCites } from "./cites.js";

// A synthetic contract: 120 pages of boilerplate with three distinctive clauses
// buried deep, which is the shape retrieval has to cope with.
const filler =
  "The parties agree that the provisions of this Agreement shall be binding upon their respective " +
  "successors and permitted assigns. Each party shall perform its obligations in good faith. ";
const pages = [];
for (let p = 1; p <= 120; p++) {
  let body = filler.repeat(12);
  if (p === 47) body += "Termination for convenience requires ninety (90) days written notice to the other party. ";
  if (p === 92) body += "The aggregate liability cap under clause 12.3 is limited to the fees paid in the preceding twelve months. ";
  if (p === 113) body += "This Agreement is governed by the laws of Singapore and subject to SIAC arbitration. ";
  pages.push(`[Page ${p}]\n${body}`);
}
const doc = pages.join("\n\n");
const BUDGET = 24000;

// --- chunking keeps citations honest -----------------------------------------
const chunks = chunkDoc(doc);
assert.ok(chunks.length > 120, "long pages should split into multiple chunks");
assert.ok(
  chunks.every((c) => /^\[Page \d+\]\n/.test(c.text)),
  "every chunk must carry its own page marker, or the model cites the wrong page",
);
for (const c of chunks) {
  const claimed = Number(c.text.match(/^\[Page (\d+)\]/)[1]);
  assert.equal(claimed, c.page, "chunk's marker must match the page it came from");
}

// --- BM25 finds the needle ----------------------------------------------------
for (const [q, page] of [
  ["what is the termination notice period", 47],
  ["what is the liability cap in clause 12.3", 92],
  ["which law governs this agreement", 113],
]) {
  const { context, matched } = pickContext(doc, q, BUDGET);
  assert.ok(matched, `"${q}" should match something`);
  assert.ok(context.includes(`[Page ${page}]`), `"${q}" should retrieve page ${page}`);
  assert.ok(context.length <= BUDGET, "must respect the budget");
}

// --- word forms: questions rarely use the document's exact inflection ---------
// "governed by the laws of" has to be findable from "which law governs".
const gov = pickContext(doc, "which law governs this agreement", BUDGET);
assert.ok(gov.context.includes("[Page 113]"), "stemming must bridge law/laws and governs/governed");
const dp = pickContext(doc, "can the supplier terminate for convenience", BUDGET);
assert.ok(dp.context.includes("[Page 47]"), "stemming must bridge terminate/termination");

// --- the relevance floor ------------------------------------------------------
const none = pickContext(doc, "zzzqqq unrelated aardvark spacecraft", BUDGET);
assert.equal(none.matched, false, "a question with no lexical footing must report no match");

// --- neighbours come along ----------------------------------------------------
const nb = pickContext(doc, "termination for convenience ninety days notice", BUDGET);
assert.ok(nb.context.includes("[Page 46]") || nb.context.includes("[Page 48]"), "neighbouring pages should be included");

// --- head is always present ---------------------------------------------------
assert.ok(nb.context.includes("[Page 1]"), "the opening pages are always kept");

// --- summaries span the document ---------------------------------------------
const intro = pickIntro(doc, BUDGET);
const seen = [...intro.matchAll(/\[Page (\d+)\]/g)].map((m) => Number(m[1]));
assert.ok(intro.length <= BUDGET * 1.1, "intro respects the budget");
assert.ok(Math.max(...seen) > 100, "summary must sample the end of the document, not just the start");
assert.ok(Math.min(...seen) < 10, "summary must include the start too");

// --- small documents are passed through whole --------------------------------
const small = "[Page 1]\nA short agreement between Alice and Bob.";
assert.equal(pickContext(small, "who are the parties", BUDGET).context, small);

// --- citations: only real pages become buttons --------------------------------
const btn = (s) => [...s.matchAll(/data-page="(\d+)"/g)].map((m) => Number(m[1]));
assert.deepEqual(btn(linkCites("see [p.12]", 120)), [12]);
assert.deepEqual(btn(linkCites("see [Page 7]", 120)), [7]);
assert.deepEqual(btn(linkCites("see [p.4, p.24, p.39]", 120)), [4, 24, 39], "lists become several buttons");
assert.deepEqual(btn(linkCites("see [p.4, p.604]", 120)), [4], "a clause number mistaken for a page is dropped");
assert.equal(linkCites("see [p.604]", 120), "see [p.604]", "an unverifiable citation is left as plain text");
assert.equal(linkCites("see [p.5]", 0), "see [p.5]", "no buttons before the page count is known");
assert.deepEqual(btn(linkCites("see [p.3, p.3]", 120)), [3], "duplicates collapse");

console.log("retrieve.js + cites.js: all checks passed");
