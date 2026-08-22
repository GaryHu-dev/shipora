// backend/scripts/capture-bbd-fixtures.mjs
//
// Pulls real product descriptions from the live storefront into a test
// fixture. The BBD parser's whole job is coping with markup a human wrote by
// hand over years — invented test HTML would only prove the parser handles
// HTML we imagined. Re-run this when the store's descriptions drift.
//
//   node scripts/capture-bbd-fixtures.mjs https://buynow.co.nz
//
import { writeFileSync } from "node:fs";

const store = process.argv[2] || "https://buynow.co.nz";
// Mirrors src/bbd.ts's PHRASE_SOURCE exactly, &nbsp; tolerance included: this
// regex decides which descriptions land in withBbd, so a description that
// separates the phrase's words with literal &nbsp; must classify the same
// way here as it will parse there — otherwise the fixture silently drops
// coverage of that case on the next capture.
const SEP = "(?:\\s|&nbsp;)*";
const PHRASE = new RegExp(
  `Best${SEP}Before${SEP}Date${SEP}\\(${SEP}BBD${SEP}\\)${SEP}From${SEP}:?`,
  "i"
);

const products = [];
for (let page = 1; page <= 20; page++) {
  const res = await fetch(`${store}/products.json?limit=250&page=${page}`);
  if (!res.ok) throw new Error(`${store} page ${page}: HTTP ${res.status}`);
  const batch = (await res.json()).products;
  if (batch.length === 0) break;
  products.push(...batch);
}

const withBbd = products.filter((p) => PHRASE.test(p.body_html || ""));
const withoutBbd = products.filter((p) => !PHRASE.test(p.body_html || "")).slice(0, 5);

const toFixture = (p) => ({ handle: p.handle, title: p.title, bodyHtml: p.body_html || "" });

const fixture = {
  capturedAt: new Date().toISOString().slice(0, 10),
  store,
  totalProducts: products.length,
  withBbd: withBbd.map(toFixture),
  withoutBbd: withoutBbd.map(toFixture),
};

writeFileSync(
  new URL("../tests/fixtures/bbd-descriptions.json", import.meta.url),
  JSON.stringify(fixture, null, 2)
);
console.log(`captured ${withBbd.length} with BBD, ${withoutBbd.length} without, of ${products.length} products`);
