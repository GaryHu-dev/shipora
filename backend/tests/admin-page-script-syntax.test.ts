import { describe, it, expect } from "vitest";
import { renderAdminPage } from "../src/routes/adminPage/index";

// The admin page's JavaScript is assembled from TypeScript template literals.
// That makes two ordinary things silently fatal in the emitted script:
//
//   - a backtick in a comment closes the template literal early;
//   - "\n" inside a string is expanded by the template literal into a REAL
//     newline, producing an unterminated JS string.
//
// Either one is a syntax error in the whole inline <script>, so nothing on the
// page runs at all: no tab switching, no search, no import, and no message the
// merchant would ever see. Both have happened. `tsc` cannot catch them because
// the TypeScript is perfectly valid — only the generated string is broken.
//
// A SyntaxError alone does not say WHERE, so on failure we locate the likely
// line ourselves. That search runs only when the parse has already failed, so
// it can be a rough heuristic without ever crying wolf on working code.
function locate(src: string): string {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const bare = lines[i].replace(/\/\/.*$/, "");          // ignore line comments
    const quotes = (bare.match(/(?<!\\)"/g) || []).length;
    if (quotes % 2) return `line ${i + 1}: ${lines[i].trim().slice(0, 90)}`;
  }
  return "(could not locate — inspect the emitted script)";
}

describe("admin page inline script", () => {
  it("is syntactically valid JavaScript", () => {
    const html = renderAdminPage("test-api-key");
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(0);

    for (const src of blocks) {
      // `new Function` parses without executing — the same grammar a browser
      // applies, and it throws on exactly the failures above.
      try {
        new Function(src);
      } catch (err) {
        throw new Error(
          `The admin page's inline script does not parse, so NOTHING on the page runs.\n` +
            `${(err as Error).message}\n` +
            `Probable location — ${locate(src)}`
        );
      }
    }
  });
});
