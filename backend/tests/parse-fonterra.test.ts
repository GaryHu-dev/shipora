import { describe, it, expect } from "vitest";
import { parseItemsIntoLines, parseSled, FonterraParseError } from "../src/purchaseOrders/parseFonterra";

// x-coordinates match the real Fonterra docket's column positions (see
// COLUMN_BOUNDS in parseFonterra.ts). y decreases going down the page (PDF
// origin is bottom-left) — row spacing is ~25pt in the real document.
const HEADER = [
  { str: "Item", x: 35, y: 200 },
  { str: "Material", x: 60, y: 200 },
  { str: "Material", x: 106, y: 210 },
  { str: "Description", x: 106, y: 200 },
  { str: "Batch", x: 238, y: 200 },
  { str: "SLED", x: 312, y: 200 },
  { str: "Ordered", x: 367, y: 210 },
  { str: "Qty", x: 377, y: 200 },
  { str: "Delivered", x: 412, y: 210 },
  { str: "Qty", x: 425, y: 200 },
  { str: "Unit", x: 459, y: 200 },
  { str: "Weight(KG)", x: 507, y: 200 },
];

// Row 10: single-line description, no wrap.
const ROW_10 = [
  { str: "10", x: 39, y: 175 },
  { str: "500123", x: 61, y: 175 },
  { str: "ACME FULL CREAM MILK 12X1L", x: 106, y: 175 },
  { str: "B1001", x: 239, y: 175 },
  { str: "15.03.2027", x: 313, y: 175 },
  { str: "10", x: 382, y: 175 },
  { str: "10", x: 431, y: 175 },
  { str: "CAR", x: 457, y: 175 },
  { str: "45.000", x: 533, y: 175 },
];

// Row 20: description wraps onto a second line 8pt below the row's anchor
// (matches the real document's wrap offset), and ordered/delivered qty
// deliberately differ — the parser must use delivered, not ordered.
const ROW_20 = [
  { str: "20", x: 39, y: 150 },
  { str: "500456", x: 61, y: 150 },
  { str: "ACME LOW FAT YOGURT", x: 106, y: 150 },
  { str: "24X125G TUB", x: 106, y: 142 },
  { str: "B1002", x: 239, y: 150 },
  { str: "01.04.2027", x: 313, y: 150 },
  { str: "6", x: 382, y: 150 },
  { str: "4", x: 431, y: 150 },
  { str: "CAR", x: 457, y: 150 },
  { str: "12.500", x: 533, y: 150 },
];

// Row 30: last row on the page. A page-summary line sits 26pt below it (same
// gap as a real "Total Product Weight" line under the last row) — the parser
// must not fold it into row 30.
const ROW_30 = [
  { str: "30", x: 39, y: 125 },
  { str: "500789", x: 61, y: 125 },
  { str: "ACME BUTTER SLTD 24X250G", x: 106, y: 125 },
  { str: "B1003", x: 239, y: 125 },
  { str: "20.02.2027", x: 313, y: 125 },
  { str: "3", x: 382, y: 125 },
  { str: "3", x: 431, y: 125 },
  { str: "CAR", x: 457, y: 125 },
  { str: "18.000", x: 533, y: 125 },
];

const PAGE_SUMMARY_DECOY = [
  { str: "Total Product Weight :", x: 375, y: 99 },
  { str: "75.500", x: 524, y: 99 },
];

describe("parseItemsIntoLines", () => {
  it("extracts every data row, ignoring the header", () => {
    const lines = parseItemsIntoLines([[...HEADER, ...ROW_10, ...ROW_20, ...ROW_30]]);
    expect(lines).toHaveLength(3);
  });

  it("reads material code, description, SLED and delivered (not ordered) qty", () => {
    const [row10, row20] = parseItemsIntoLines([[...HEADER, ...ROW_10, ...ROW_20]]);
    expect(row10).toEqual({
      materialCode: "500123",
      description: "ACME FULL CREAM MILK 12X1L",
      sled: "15.03.2027",
      deliveredQty: 10,
    });
    expect(row20.deliveredQty).toBe(4); // delivered (4), not ordered (6)
  });

  it("joins a wrapped two-line description into one string", () => {
    const [row20] = parseItemsIntoLines([[...HEADER, ...ROW_20]]);
    expect(row20.description).toBe("ACME LOW FAT YOGURT 24X125G TUB");
  });

  it("does not fold a page-summary line below the last row into that row", () => {
    const lines = parseItemsIntoLines([[...HEADER, ...ROW_30, ...PAGE_SUMMARY_DECOY]]);
    expect(lines).toHaveLength(1);
    expect(lines[0].materialCode).toBe("500789");
    expect(lines[0].description).toBe("ACME BUTTER SLTD 24X250G");
  });

  it("stitches rows across multiple pages into one list", () => {
    const lines = parseItemsIntoLines([[...HEADER, ...ROW_10], [...HEADER, ...ROW_20]]);
    expect(lines.map((l) => l.materialCode)).toEqual(["500123", "500456"]);
  });

  it("ignores blank/whitespace-only text items", () => {
    const withBlanks = [...HEADER, ...ROW_10, { str: "", x: 100, y: 175 }, { str: " ", x: 200, y: 175 }];
    const lines = parseItemsIntoLines([withBlanks]);
    expect(lines).toHaveLength(1);
  });

  it("throws FonterraParseError when a row is missing a required column", () => {
    const brokenRow = ROW_10.filter((it) => it.x !== 313); // drop the SLED cell
    expect(() => parseItemsIntoLines([[...HEADER, ...brokenRow]])).toThrow(FonterraParseError);
  });

  it("throws FonterraParseError when no data rows are found at all", () => {
    expect(() => parseItemsIntoLines([HEADER])).toThrow(FonterraParseError);
  });
});

// Regression for the quirks the real Fonterra docket has that the fixtures above
// don't — these broke the original downward-only band and were only caught against
// the real PDF. Coordinates mirror the real document (header at y=546, ~25pt row
// pitch): a numeric SHIP-TO account number ABOVE the table in the item x-column,
// and rows whose description first line sits ~1pt ABOVE the item-number anchor
// with the wrap ~7pt below. Delivered qty differs from ordered to re-check that too.
describe("real-layout quirks (regression)", () => {
  const HDR = [
    { str: "Item", x: 35, y: 546 }, { str: "Material", x: 60, y: 546 },
    { str: "Description", x: 106, y: 546 }, { str: "Batch", x: 238, y: 546 },
    { str: "SLED", x: 312, y: 546 }, { str: "Qty", x: 425, y: 546 },
  ];
  const STRAY_ABOVE = [{ str: "0004009297", x: 38, y: 677 }]; // SHIP-TO account no. — item column, above header
  const R10 = [
    { str: "10", x: 39, y: 522 }, { str: "122352", x: 61, y: 522 },
    { str: "ANC BTR SLTD MY 24X454G", x: 106, y: 523 }, // desc line 1 ABOVE the anchor
    { str: "CAN CTN", x: 106, y: 515 },                 // wrap BELOW
    { str: "32001420", x: 239, y: 522 }, { str: "22.11.2027", x: 313, y: 522 },
    { str: "7", x: 382, y: 522 }, { str: "5", x: 431, y: 522 }, // ordered 7, delivered 5
    { str: "CAR", x: 457, y: 522 },
  ];
  const R20 = [
    { str: "20", x: 39, y: 497 }, { str: "3113493", x: 61, y: 497 },
    { str: "ANC WMP INST 12X1KG SCT", x: 106, y: 498 }, { str: "CTN", x: 106, y: 490 },
    { str: "FBW02972", x: 239, y: 497 }, { str: "10.11.2027", x: 313, y: 497 },
    { str: "2", x: 382, y: 497 }, { str: "2", x: 431, y: 497 }, { str: "CAR", x: 457, y: 497 },
  ];
  const SUMMARY = [{ str: "Total Product Weight :", x: 375, y: 471 }, { str: "1,716.506", x: 524, y: 471 }];

  it("ignores an item-column number above the header, keeps above-anchor descriptions, and doesn't bleed rows", () => {
    const lines = parseItemsIntoLines([[...STRAY_ABOVE, ...HDR, ...R10, ...R20, ...SUMMARY]]);
    expect(lines).toHaveLength(2); // stray account number and page-summary line both ignored
    expect(lines[0]).toEqual({ materialCode: "122352", description: "ANC BTR SLTD MY 24X454G CAN CTN", sled: "22.11.2027", deliveredQty: 5 });
    expect(lines[1]).toEqual({ materialCode: "3113493", description: "ANC WMP INST 12X1KG SCT CTN", sled: "10.11.2027", deliveredQty: 2 });
  });
});

describe("parseSled", () => {
  it("converts DD.MM.YYYY to an ISO date", () => {
    expect(parseSled("22.11.2027")).toBe("2027-11-22");
  });

  it("pads single-digit day/month", () => {
    expect(parseSled("1.4.2027")).toBe("2027-04-01");
  });
});
