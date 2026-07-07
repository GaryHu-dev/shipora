import { shopifyGraphQL } from "./graphql";

const NOTE_QUERY = `query OrderNote($id: ID!) { order(id: $id) { note } }`;
const NOTE_MUTATION = `
mutation OrderNote($id: ID!, $note: String!) {
  orderUpdate(input: { id: $id, note: $note }) {
    userErrors { field message }
  }
}`;

const NOTE_HEADER = "Shipora";

// Append a line to the order's note under a single "Shipora" header. Changing the
// note produces a visible entry in the Shopify order Timeline (Shopify has no API
// for arbitrary timeline comments, so this is the supported way to leave a trail).
export async function appendOrderNote(
  shopDomain: string,
  accessToken: string,
  orderGid: string,
  line: string
): Promise<void> {
  const data = await shopifyGraphQL<{ order: { note: string | null } | null }>(shopDomain, accessToken, NOTE_QUERY, { id: orderGid });
  const current = data.order?.note ?? "";
  const hasHeader = current.split("\n").some((l) => l.trim() === NOTE_HEADER);
  let note: string;
  if (hasHeader) {
    note = `${current}\n${line}`;                       // header already there — append
  } else if (current) {
    note = `${current}\n\n${NOTE_HEADER}\n${line}`;     // keep merchant note, add our section
  } else {
    note = `${NOTE_HEADER}\n${line}`;                   // fresh note — header at the top
  }
  const res = await shopifyGraphQL<{ orderUpdate: { userErrors: { message: string }[] } }>(
    shopDomain, accessToken, NOTE_MUTATION, { id: orderGid, note }
  );
  if (res.orderUpdate.userErrors.length > 0) {
    throw new Error(res.orderUpdate.userErrors.map((e) => e.message).join("; "));
  }
}

// Remove ONE note line exactly matching `exactLine` (a deleted photo's upload
// line) so the order note stays in sync with the photos that still exist. Drops
// the lone "Shipora" header if no entries remain under it.
export async function removeOrderNoteLine(
  shopDomain: string,
  accessToken: string,
  orderGid: string,
  exactLine: string
): Promise<void> {
  const data = await shopifyGraphQL<{ order: { note: string | null } | null }>(shopDomain, accessToken, NOTE_QUERY, { id: orderGid });
  const current = data.order?.note ?? "";
  if (!current) return;

  const lines = current.split("\n");
  const idx = lines.findIndex((l) => l.trim() === exactLine.trim());
  if (idx === -1) return;
  lines.splice(idx, 1);

  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const kept = nonEmpty.length === 1 && nonEmpty[0].trim() === NOTE_HEADER
    ? lines.filter((l) => l.trim() !== NOTE_HEADER)
    : lines;
  const note = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const res = await shopifyGraphQL<{ orderUpdate: { userErrors: { message: string }[] } }>(
    shopDomain, accessToken, NOTE_MUTATION, { id: orderGid, note }
  );
  if (res.orderUpdate.userErrors.length > 0) {
    throw new Error(res.orderUpdate.userErrors.map((e) => e.message).join("; "));
  }
}
