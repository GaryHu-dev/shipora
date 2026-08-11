import { describe, it, expect } from "vitest";
import { parseBbd, countBbdPhrases, formatBbd } from "../src/bbd";
import fixture from "./fixtures/bbd-descriptions.json";

describe("parseBbd — real store descriptions", () => {
  it("parses every real description that carries a BBD line", () => {
    const failures: string[] = [];
    for (const p of fixture.withBbd) {
      const state = parseBbd(p.bodyHtml);
      if (state.kind !== "parsed") failures.push(`${p.handle}: ${state.kind}`);
    }
    // Every one of these was hand-written by the merchant over several years.
    // If any fails to parse, the Stock tab would show "Unrecognised" for a
    // product that plainly has a date — list them rather than just failing.
    expect(failures).toEqual([]);
  });

  it("reports absent for descriptions with no BBD line", () => {
    for (const p of fixture.withoutBbd) {
      expect(parseBbd(p.bodyHtml).kind).toBe("absent");
    }
  });

  it("finds exactly one phrase in each real BBD description", () => {
    for (const p of fixture.withBbd) {
      expect(countBbdPhrases(p.bodyHtml)).toBe(1);
    }
  });

  it("reads a value nested inside a tag, not as empty", () => {
    // `From: <span>Sep 2027</span></strong>` — a naive [^<]* capture returns "".
    const nested = fixture.withBbd.filter((p) => /From:\s*<span>/i.test(p.bodyHtml));
    expect(nested.length).toBeGreaterThan(0);
    for (const p of nested) {
      const state = parseBbd(p.bodyHtml);
      expect(state.kind).toBe("parsed");
      if (state.kind === "parsed") expect(state.year).toBeGreaterThan(2000);
    }
  });
});

describe("parseBbd — constructed cases", () => {
  const wrap = (inner: string) => `<p>Some copy.</p>\n<p><strong>${inner}</strong></p>`;

  it("parses an abbreviated month", () => {
    expect(parseBbd(wrap("Best Before Date (BBD) From: Oct 2026")))
      .toEqual({ kind: "parsed", year: 2026, month: 10, text: "Oct 2026" });
  });

  it("parses a full month name", () => {
    expect(parseBbd(wrap("Best Before Date (BBD) From: February 2027")))
      .toEqual({ kind: "parsed", year: 2027, month: 2, text: "February 2027" });
  });

  it("parses a four-letter abbreviation", () => {
    const state = parseBbd(wrap("Best Before Date (BBD) From: Sept 2026"));
    expect(state).toMatchObject({ kind: "parsed", year: 2026, month: 9 });
  });

  it("tolerates &nbsp; inside the phrase", () => {
    const state = parseBbd(wrap("Best&nbsp;Before Date (BBD)&nbsp;From: May 2027"));
    expect(state).toMatchObject({ kind: "parsed", year: 2027, month: 5 });
  });

  it("is case-insensitive", () => {
    expect(parseBbd(wrap("BEST BEFORE DATE (BBD) FROM: june 2027")))
      .toMatchObject({ kind: "parsed", year: 2027, month: 6 });
  });

  it("does not let a void tag after the phrase swallow the region", () => {
    // <meta> never closes. Counting it as an open tag would run the scan past
    // </strong> and drag half the document into the value.
    const state = parseBbd(wrap('Best Before Date (BBD) From: <meta charset="utf-8">Nov 2027'));
    expect(state).toMatchObject({ kind: "parsed", year: 2027, month: 11 });
  });

  it("does not mistake a trailing slash in an unquoted attribute for self-close", () => {
    // `data-x=a/` is an unquoted attribute value ending in "/" — not
    // self-closing syntax. Treating it as self-close skips the depth++ for
    // <span>, so the scan stops at </span> instead of </strong> and
    // truncates the value to "Oct" instead of "Oct 2026".
    const state = parseBbd(wrap("Best Before Date (BBD) From: <span data-x=a/>Oct</span> 2026"));
    expect(state).toMatchObject({ kind: "parsed", year: 2026, month: 10 });
  });

  it("reports unparseable — never absent — when the value makes no sense", () => {
    // This distinction guards Stage 2: treating "can't read it" as "isn't
    // there" would append a SECOND BBD line to a product that already has one.
    const state = parseBbd(wrap("Best Before Date (BBD) From: ask the supplier"));
    expect(state.kind).toBe("unparseable");
  });

  it("reports unparseable for an empty value", () => {
    expect(parseBbd(wrap("Best Before Date (BBD) From:")).kind).toBe("unparseable");
  });

  it("reports absent for an empty or missing description", () => {
    expect(parseBbd("").kind).toBe("absent");
    expect(parseBbd(null).kind).toBe("absent");
    expect(parseBbd(undefined).kind).toBe("absent");
  });

  it("counts duplicate phrases", () => {
    const two = wrap("Best Before Date (BBD) From: Oct 2026") + wrap("Best Before Date (BBD) From: Nov 2026");
    expect(countBbdPhrases(two)).toBe(2);
  });
});

describe("formatBbd", () => {
  it("always writes the full month name", () => {
    // The store mixes "Oct 2026" and "February 2027"; new writes standardise.
    expect(formatBbd(2026, 10)).toBe("October 2026");
    expect(formatBbd(2027, 3)).toBe("March 2027");
  });
});
