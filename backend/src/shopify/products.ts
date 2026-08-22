import { shopifyGraphQL } from "./graphql";

export interface VariantCandidate {
  id: string;
  sku: string | null;
  title: string;
  productId: string;
  imageUrl: string | null;
  /** The page a customer sees. Null when the product is not published online. */
  onlineStoreUrl: string | null;
}

// Every search in this file is limited to ACTIVE products.
//
// A draft is something the merchant has not put on sale; it is not stock they
// count, and it must never be what a delivery-note line gets matched to. On
// the shop this was built for, 414 of 713 products are drafts — searching all
// of them made every picker mostly noise.
//
// Two gotchas, both verified against a live shop:
//   - `products` takes `status:active`, but `productVariants` takes
//     `product_status:active` — different field names on the two connections.
//   - The value must be LOWERCASE. `product_status:ACTIVE` does not error;
//     it silently returns zero results.
const ACTIVE_PRODUCTS = "status:active";
const ACTIVE_VARIANTS = "product_status:active";

const SEARCH_VARIANTS_QUERY = `
query SearchVariants($query: String!) {
  productVariants(first: 10, query: $query) {
    edges { node { id sku displayName image { url } product { id featuredImage { url } } } }
  }
}`;

interface SearchVariantsResult {
  productVariants: {
    edges: {
      node: {
        id: string;
        sku: string | null;
        displayName: string;
        image: { url: string } | null;
        product: { id: string; featuredImage: { url: string } | null; onlineStoreUrl: string | null; onlineStorePreviewUrl: string | null };
      };
    }[];
  };
}

// Shopify's variant displayName appends " - Default Title" for single-variant
// products (their only variant is the default). Drop it; keep real variant
// options like " - 1L / Blue".
function cleanTitle(displayName: string): string {
  return displayName.replace(/\s*-\s*Default Title$/i, "");
}

function toCandidates(data: SearchVariantsResult): VariantCandidate[] {
  return data.productVariants.edges.map((e) => ({
    id: e.node.id,
    sku: e.node.sku,
    title: cleanTitle(e.node.displayName),
    productId: e.node.product.id,
    imageUrl: e.node.image?.url ?? e.node.product.featuredImage?.url ?? null,
    onlineStoreUrl: e.node.product.onlineStoreUrl ?? e.node.product.onlineStorePreviewUrl ?? null,
  }));
}

export async function findVariantBySku(
  shopDomain: string,
  accessToken: string,
  sku: string
): Promise<VariantCandidate | null> {
  const data = await shopifyGraphQL<SearchVariantsResult>(shopDomain, accessToken, SEARCH_VARIANTS_QUERY, {
    query: `sku:${sku} AND ${ACTIVE_VARIANTS}`,
  });
  const candidates = toCandidates(data);
  return candidates.find((c) => (c.sku ?? "").toLowerCase() === sku.toLowerCase()) ?? null;
}

// Title search runs against the PRODUCTS connection, not productVariants: on a
// variant, `title` is the option title ("Default Title", "1L / Blue"), never the
// product name. products' `title`/`sku` filters do what a merchant expects. Each
// matching product contributes its variants as candidates.
const SEARCH_PRODUCTS_QUERY = `
query SearchProducts($query: String!) {
  products(first: 10, query: $query) {
    edges { node {
      id
      featuredImage { url }
      variants(first: 10) { edges { node { id sku displayName image { url } } } }
    } }
  }
}`;

interface SearchProductsResult {
  products: {
    edges: {
      node: {
        id: string;
        featuredImage: { url: string } | null;
        onlineStoreUrl: string | null;
        onlineStorePreviewUrl: string | null;
        variants: { edges: { node: { id: string; sku: string | null; displayName: string; image: { url: string } | null } }[] };
      };
    }[];
  };
}

async function runProductSearch(shopDomain: string, accessToken: string, query: string): Promise<VariantCandidate[]> {
  // Parenthesised: callers pass OR-joined clauses, and `a OR b AND c` would
  // bind the status filter to b alone.
  const data = await shopifyGraphQL<SearchProductsResult>(shopDomain, accessToken, SEARCH_PRODUCTS_QUERY, {
    query: `(${query}) AND ${ACTIVE_PRODUCTS}`,
  });
  const out: VariantCandidate[] = [];
  for (const p of data.products.edges) {
    for (const v of p.node.variants.edges) {
      out.push({
        id: v.node.id,
        sku: v.node.sku,
        title: cleanTitle(v.node.displayName),
        productId: p.node.id,
        imageUrl: v.node.image?.url ?? p.node.featuredImage?.url ?? null,
        onlineStoreUrl: p.node.onlineStoreUrl ?? p.node.onlineStorePreviewUrl ?? null,
      });
    }
  }
  return out;
}

// Builds an OR-of-title-prefix query from the description's significant tokens
// (alphabetic, length >= 3 — skips short unit/pack-size fragments like "1L" or
// "6X"), so a loosely-worded PDF description still surfaces plausible Shopify
// product candidates for the fuzzy scorer to rank. Shopify supports a trailing
// wildcard (`title:anc*`) but NOT a leading one, so match on word prefixes.
export async function searchVariantCandidates(
  shopDomain: string,
  accessToken: string,
  text: string
): Promise<VariantCandidate[]> {
  const tokens = text
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((t) => t.length >= 3)
    .slice(0, 3);
  if (tokens.length === 0) return [];

  const query = tokens.map((t) => `title:${t}*`).join(" OR ");
  return runProductSearch(shopDomain, accessToken, query);
}

// Shopify's search matches a prefix and nothing else: for SKU 3110886,
// `sku:311*` finds it, `sku:108*` does not, and a leading wildcard — `sku:*108*`
// — is simply not supported (verified against a live shop). Typing a few digits
// from the middle of a code is a natural thing to do and could never work
// through the query API.
//
// So when the prefix search comes back empty we scan instead. This shop holds
// ~700 variants; a few pages of 250 is affordable as a fallback, and it only
// runs when the cheap path has already failed.
const ALL_VARIANTS_QUERY = `
query AllVariants($first: Int!, $after: String, $query: String!) {
  productVariants(first: $first, after: $after, query: $query) {
    edges {
      cursor
      node {
        id
        sku
        displayName
        image { url }
        product { id featuredImage { url } onlineStoreUrl onlineStorePreviewUrl }
      }
    }
    pageInfo { hasNextPage }
  }
}`;

interface AllVariantsResult {
  productVariants: {
    edges: {
      cursor: string;
      node: {
        id: string;
        sku: string | null;
        displayName: string;
        image: { url: string } | null;
        product: { id: string; featuredImage: { url: string } | null; onlineStoreUrl: string | null; onlineStorePreviewUrl: string | null };
      };
    }[];
    pageInfo: { hasNextPage: boolean };
  };
}

const SCAN_PAGES = 6; // 1500 variants; well past this shop and still bounded

async function scanVariantsContaining(
  shopDomain: string,
  accessToken: string,
  needle: string
): Promise<VariantCandidate[]> {
  const q = needle.toLowerCase();
  const hits: VariantCandidate[] = [];
  let after: string | null = null;

  for (let page = 0; page < SCAN_PAGES; page++) {
    const data: AllVariantsResult = await shopifyGraphQL<AllVariantsResult>(
      shopDomain,
      accessToken,
      ALL_VARIANTS_QUERY,
      { first: 250, after, query: ACTIVE_VARIANTS }
    );
    for (const e of data.productVariants.edges) {
      const n = e.node;
      const sku = (n.sku ?? "").toLowerCase();
      if (sku.includes(q) || cleanTitle(n.displayName).toLowerCase().includes(q)) {
        hits.push({
          id: n.id,
          sku: n.sku,
          title: cleanTitle(n.displayName),
          productId: n.product.id,
          imageUrl: n.image?.url ?? n.product.featuredImage?.url ?? null,
          onlineStoreUrl: n.product.onlineStoreUrl ?? n.product.onlineStorePreviewUrl ?? null,
        });
        if (hits.length >= 20) return hits;
      }
    }
    if (!data.productVariants.pageInfo.hasNextPage) break;
    after = data.productVariants.edges[data.productVariants.edges.length - 1].cursor;
  }
  return hits;
}

// Interactive product search for the manual picker: forgiving of whatever the
// merchant types. Strips Shopify search operators, then matches each word as a
// title prefix OR the first word as a SKU prefix. Broad (OR) so results appear
// even for a partial or messy query; the merchant picks the right one.
export async function searchVariantsByQuery(
  shopDomain: string,
  accessToken: string,
  text: string
): Promise<VariantCandidate[]> {
  // Hyphens are kept inside a word — SKUs are full of them, and stripping them
  // split "ANC-122352" into two terms that then matched nothing useful. Only a
  // leading or trailing hyphen is dropped, because Shopify reads that as an
  // exclusion operator.
  const cleaned = text.replace(/[:()"*\\]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 2) return [];
  const terms = cleaned
    .split(" ")
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .slice(0, 4);
  if (terms.length === 0) return [];

  // Every term is tried as a title prefix AND a SKU prefix. Only the first term
  // used to be searched as a SKU, so typing a product name followed by its code
  // — the natural thing to do — never searched the code as a code.
  // Three passes, strictest first. The point is that adding a word must
  // NARROW the result — with a single OR over every term it did the opposite:
  // "Anchor Butter" matched anything containing "Anchor", Shopify ranked that
  // set its own way, and the two actual Anchor butters fell outside the first
  // ten. Typing more of the product's name made it harder to find, which is
  // the reverse of what anyone expects.

  // 1. Every term must match something — title OR sku, so "anchor 112419"
  //    (a name plus its code) still works.
  const strict = await runProductSearch(
    shopDomain,
    accessToken,
    terms.map((t) => `(title:${t}* OR sku:${t}*)`).join(" AND ")
  );
  if (strict.length > 0) return strict;

  // 2. Nothing matched every term — a typo, or a word the product does not
  //    carry. Any term will do rather than showing nothing.
  const loose = await runProductSearch(
    shopDomain,
    accessToken,
    terms.flatMap((t) => [`title:${t}*`, `sku:${t}*`]).join(" OR ")
  );
  if (loose.length > 0) return loose;

  // 3. No prefix matched at all: scan, so a fragment from the middle of a SKU
  //    still finds its product.
  return scanVariantsContaining(shopDomain, accessToken, terms.join(" "));
}
