// backend/src/bbd.ts
//
// Reads the Best Before Date out of a Shopify product description.
//
// BBD is not a Shopify field. On this store it is a line of prose the merchant
// typed into the product description:
//
//   Best Before Date (BBD) From: June 2027
//
// The phrase is uniform across every product that has one, but the markup
// wrapping it is not — observed forms include <div class="details">, a bare
// <p><strong>, and <p><meta charset="utf-8"><span style="..."><strong>. So we
// locate the phrase textually and read the value that follows it, without any
// assumption about the surrounding tags.
//
// Pure string functions: no Shopify, no D1, no DOM. That is what lets the
// tests run the real store's 50 descriptions through it offline.

export type BbdState =
  | { kind: "parsed"; year: number; month: number; text: string }
  | { kind: "unparseable"; text: string }
  | { kind: "absent" };

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// Separator that also swallows &nbsp;. Matching the entity in place — rather
// than normalising the HTML first — keeps every offset aligned with the
// original string, which Stage 2's byte-precise replacement depends on.
const SEP = "(?:\\s|&nbsp;)*";
const PHRASE_SOURCE =
  `Best${SEP}Before${SEP}Date${SEP}\\(${SEP}BBD${SEP}\\)${SEP}From${SEP}:?`;

// HTML void elements never close, so they must not increment tag depth.
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

export function countBbdPhrases(descriptionHtml: string): number {
  return (descriptionHtml.match(new RegExp(PHRASE_SOURCE, "gi")) ?? []).length;
}

/**
 * Index of the `>` that closes the tag starting at `html[start]` ("<").
 *
 * Not a bare `html.indexOf(">", start)` — a `>` can sit inside a quoted
 * attribute value (`<div title="a>b">`), and treating that as the tag's end
 * would truncate the tag and desynchronise every offset after it. Track
 * quote state instead so a quoted `>` is skipped.
 */
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let j = start + 1; j < html.length; j++) {
    const c = html[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return j;
    }
  }
  return -1;
}

/**
 * Whether `tagInner` — a tag's content between `<` and `>`, exclusive —
 * ends in genuine self-closing syntax (`<br/>`, `<img src="x"/>`).
 *
 * Not a bare "does the char before `>` equal `/`" — an unquoted attribute
 * value can itself end in `/` (`<span data-x=a/>`), in which case the slash
 * belongs to the value, not to the tag. HTML's own tokenizer only treats a
 * trailing `/` as self-closing when it appears outside any attribute value,
 * so track quote/unquoted-value state up to that trailing slash and ask
 * what state it would land in.
 */
function isSelfClosingTag(tagInner: string): boolean {
  if (!tagInner.endsWith("/")) return false;

  type State = "default" | "afterEquals" | "quoted" | "unquoted";
  let state: State = "default";
  let quote = "";

  for (const c of tagInner.slice(0, -1)) {
    if (state === "quoted") {
      if (c === quote) state = "default";
    } else if (state === "unquoted") {
      if (/\s/.test(c)) state = "default";
    } else if (state === "afterEquals") {
      if (c === '"' || c === "'") {
        state = "quoted";
        quote = c;
      } else if (!/\s/.test(c)) {
        state = "unquoted";
      }
    } else if (c === "=") {
      state = "afterEquals";
    }
  }
  // Landing in "unquoted" means the trailing slash is the last character of
  // an unquoted attribute value, not a self-close marker.
  return state !== "unquoted";
}

/**
 * End offset of the value that follows the phrase at `from`.
 *
 * Not "everything up to the next `<`" — three products on this store write
 * `From: <span>Sep 2027</span></strong>`, where that rule yields an empty
 * value. Instead, walk forward tracking tag depth and stop at the first
 * closing tag that we did not open: that is the tag enclosing the phrase, so
 * its start is where the value ends.
 */
function findValueEnd(html: string, from: number): number {
  let i = from;
  let depth = 0;

  while (i < html.length) {
    if (html[i] !== "<") {
      i++;
      continue;
    }
    const close = findTagEnd(html, i);
    if (close === -1) return html.length; // malformed tail; take the rest

    const isClosing = html[i + 1] === "/";
    const name = /^<\/?\s*([a-zA-Z0-9-]+)/.exec(html.slice(i, close + 1))?.[1]?.toLowerCase() ?? "";
    const selfClosing = isSelfClosingTag(html.slice(i + 1, close));

    if (isClosing) {
      if (depth === 0) return i; // the tag that wraps the phrase — value ends here
      depth--;
    } else if (!selfClosing && !VOID_TAGS.has(name)) {
      depth++;
    }
    i = close + 1;
  }
  return html.length;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
}

/** "Oct 2026" / "February 2027" / "Sept 2026" → 1-based month + year. */
function parseMonthYear(text: string): { year: number; month: number } | null {
  const m = /^([A-Za-z]{3,9})\.?[\s,]+(\d{4})$/.exec(text.trim());
  if (!m) return null;

  const token = m[1].toLowerCase();
  // Prefix match handles "oct", "sept" and "september" alike. Three characters
  // is the shortest unambiguous prefix for every month (jan/jun/jul, mar/may).
  const idx = MONTHS.findIndex((name) => name.startsWith(token));
  if (idx === -1) return null;

  const year = Number(m[2]);
  if (year < 2000 || year > 2100) return null;

  return { year, month: idx + 1 };
}

export function parseBbd(descriptionHtml: string | null | undefined): BbdState {
  if (!descriptionHtml) return { kind: "absent" };

  const match = new RegExp(PHRASE_SOURCE, "i").exec(descriptionHtml);
  if (!match) return { kind: "absent" };

  const valueStart = match.index + match[0].length;
  const valueEnd = findValueEnd(descriptionHtml, valueStart);
  const text = decodeEntities(stripTags(descriptionHtml.slice(valueStart, valueEnd))).trim();

  const parsed = parseMonthYear(text);
  // Deliberately NOT falling back to "absent": the phrase is present, so a
  // caller must never conclude the product lacks a BBD line and add another.
  if (!parsed) return { kind: "unparseable", text };

  return { kind: "parsed", year: parsed.year, month: parsed.month, text };
}

export function formatBbd(year: number, month: number): string {
  const name = MONTHS[month - 1];
  if (!name) throw new Error(`month out of range: ${month}`);
  return `${name[0].toUpperCase()}${name.slice(1)} ${year}`;
}
