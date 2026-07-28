// Turning the model's page citations into clickable buttons.
//
// Kept pure (and separate from main.js) so it can be tested: this is the one
// piece of UI that carries the app's core promise — that every claim is one
// click from the page it came from — so it has to be right about which numbers
// are real pages.

// Matches a bracketed citation holding one or more page refs:
//   [p.3]  [page 3]  [p.4, p.24, p.39]  [Page 7; p.9]
const CITE = /\[((?:(?:page|p)\.?\s*\d+\s*[,;]?\s*)+)\]/gi;

// Models routinely cite a clause or paragraph number as though it were a page —
// contracts are full of numbered clauses, and a 120-page contract can easily
// produce "[p.604]". A button that scrolls nowhere is worse than no button, so
// out-of-range numbers are dropped rather than rendered as something checkable.
// If nothing in the bracket is a real page, the model's own text is left alone
// rather than silently deleted.
export function linkCites(html, pages) {
  return html.replace(CITE, (whole, inner) => {
    const ok = [...inner.matchAll(/\d+/g)]
      .map((m) => Number(m[0]))
      .filter((n) => n >= 1 && n <= pages);
    if (!ok.length) return whole;
    return [...new Set(ok)]
      .map((n) => `<button class="cite" data-page="${n}" type="button">p. ${n}</button>`)
      .join(" ");
  });
}
