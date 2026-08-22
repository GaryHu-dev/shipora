// Before bumping this: the Stock tab's whole safety story rests on
// `compareQuantity` / `ignoreCompareQuantity` in `inventorySetQuantities`
// (see shopify/stockList.ts), and Shopify deprecated both from API 2026-01,
// with an `@idempotent` directive becoming mandatory from 2026-04. A version
// bump therefore is not a config change — it requires reworking the mechanism
// that stops a stale page from silently erasing a sale. Read the current
// inventory API docs and re-verify the mutation shape first.
export const SHOPIFY_API_VERSION = "2025-10";

export async function shopifyGraphQL<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Shopify GraphQL HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}
