import { getDocumentProxy, extractTextItems } from "unpdf";

export interface ParsedLine {
  materialCode: string;
  description: string;
  sled: string; // DD.MM.YYYY, as printed
  deliveredQty: number;
}

export class FonterraParseError extends Error {}

export interface TextItem {
  str: string;
  x: number;
  y: number;
}

type Column =
  | "item" | "material" | "description" | "batch" | "sled"
  | "orderedQty" | "deliveredQty" | "unit" | "dg" | "weight";

// Left edge (PDF points) of each column, measured off a real Fonterra
// delivery docket's header row. Column assignment is "last boundary at or
// below this x", so these must stay sorted ascending.
const COLUMN_BOUNDS: { column: Column; from: number }[] = [
  { column: "item", from: 0 },
  { column: "material", from: 47 },
  { column: "description", from: 83 },
  { column: "batch", from: 172 },
  { column: "sled", from: 275 },
  { column: "orderedQty", from: 339 },
  { column: "deliveredQty", from: 389 },
  { column: "unit", from: 435 },
  { column: "dg", from: 470 },
  { column: "weight", from: 494 },
];

function columnFor(x: number): Column {
  let col: Column = "item";
  for (const b of COLUMN_BOUNDS) {
    if (x >= b.from) col = b.column;
  }
  return col;
}

const SLED_RE = /^\d{2}\.\d{2}\.\d{4}$/;

export function parseSled(sled: string): string {
  const [d, m, y] = sled.split(".");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function parseItemsIntoLines(pages: TextItem[][]): ParsedLine[] {
  const lines = pages.flatMap((page) => parsePage(page));
  if (lines.length === 0) {
    throw new FonterraParseError(
      "no line items found — PDF layout did not match the expected Fonterra delivery docket format"
    );
  }
  return lines;
}

function parsePage(pageItems: TextItem[]): ParsedLine[] {
  const nonBlank = pageItems.filter((it) => it.str.trim() !== "");

  // Locate the table header (the "SLED" column label). Data rows sit below it
  // (smaller y — PDF origin is bottom-left). If the page has no table header it
  // contributes no rows. This bounds the parse to the table region so numeric
  // text ABOVE the table — e.g. the SHIP-TO account number, which also lands in
  // the "item" x-column — is never mistaken for a row anchor.
  const header = nonBlank.find((it) => it.str.trim() === "SLED");
  if (!header) return [];
  const headerY = header.y;

  // A row's anchor is a plain integer in the "item" column, below the header.
  // The header's "Item" label and any page-summary text never satisfy this, so
  // they never start a row.
  const anchors = nonBlank
    .filter((it) => columnFor(it.x) === "item" && /^\d+$/.test(it.str.trim()) && it.y < headerY)
    .sort((a, b) => b.y - a.y); // higher y = higher on the page = earlier row
  if (anchors.length === 0) return [];

  // Group each item with the vertically NEAREST anchor. A row's cells straddle
  // its item number by a few points — the description's first line sits ~1pt
  // ABOVE the number and its wrapped second line ~8pt below — so a downward-only
  // band both drops the first line and bleeds into the next row. ROW_BAND caps
  // the distance so a page-summary line (~26pt below the last row) is dropped
  // rather than folded in. Measured from the Fonterra layout (row pitch ~25pt).
  const ROW_BAND = 12;
  const rows: TextItem[][] = anchors.map(() => []);
  for (const it of nonBlank) {
    if (it.y >= headerY) continue; // header row and everything above the table
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs(it.y - anchors[i].y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (bestDist <= ROW_BAND) rows[best].push(it);
  }
  return rows.map((items) => buildLine(items));
}

function cellText(rowItems: TextItem[], column: Column): string {
  return rowItems
    .filter((it) => columnFor(it.x) === column)
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((it) => it.str.trim())
    .join(" ")
    .trim();
}

function buildLine(rowItems: TextItem[]): ParsedLine {
  const materialCode = cellText(rowItems, "material");
  const description = cellText(rowItems, "description");
  const sled = cellText(rowItems, "sled");
  const deliveredQty = Number.parseInt(cellText(rowItems, "deliveredQty"), 10);

  if (!materialCode || !description || !SLED_RE.test(sled) || !Number.isInteger(deliveredQty)) {
    throw new FonterraParseError(`could not parse a table row (material code: ${materialCode || "unknown"})`);
  }

  return { materialCode, description, sled, deliveredQty };
}

export async function parseFonterraDeliveryNote(pdfBytes: Uint8Array): Promise<ParsedLine[]> {
  const pdf = await getDocumentProxy(pdfBytes);
  const { items } = await extractTextItems(pdf);
  return parseItemsIntoLines(items);
}
