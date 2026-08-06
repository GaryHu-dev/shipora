import { describe, it, expect } from "vitest";
import { getDocumentProxy, extractTextItems } from "unpdf";

// Minimal valid single-page PDF (synthetic). Exercises the unpdf/pdfjs load path
// inside workerd — the runtime the deployed Worker actually uses — which the
// pure parseItemsIntoLines tests never touch.
const MINIMAL_PDF_B64 =
  "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXS9SZXNvdXJjZXM8PD4+Pj4KZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU0IDAwMDAwIG4gCjAwMDAwMDAxMDUgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxODQKJSVFT0Y=";

function pdfBytes(): Uint8Array {
  const bin = atob(MINIMAL_PDF_B64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

describe("unpdf runtime (workerd)", () => {
  it("loads and extracts text from a PDF without a runtime error", async () => {
    const pdf = await getDocumentProxy(pdfBytes());
    const { totalPages, items } = await extractTextItems(pdf);
    expect(totalPages).toBe(1);
    expect(Array.isArray(items)).toBe(true);
  });
});
