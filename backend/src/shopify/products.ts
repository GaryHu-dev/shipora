import { shopifyGraphQL } from "./graphql";

export interface VariantCandidate {
  id: string;
  sku: string | null;
  title: string;
  productId: string;
  imageUrl: string | null;
}

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
        product: { id: string; featuredImage: { url: string } | null };
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
  }));
}

export async function findVariantBySku(
  shopDomain: string,
  accessToken: string,
  sku: string
): Promise<VariantCandidate | null> {
  const data = await shopifyGraphQL<SearchVariantsResult>(shopDomain, accessToken, SEARCH_VARIANTS_QUERY, {
    query: `sku:${sku}`,
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
        variants: { edges: { node: { id: string; sku: string | null; displayName: string; image: { url: string } | null } }[] };
      };
    }[];
  };
}

async function runProductSearch(shopDomain: string, accessToken: string, query: string): Promise<VariantCandidate[]> {
  const data = await shopifyGraphQL<SearchProductsResult>(shopDomain, accessToken, SEARCH_PRODUCTS_QUERY, { query });
  const out: VariantCandidate[] = [];
  for (const p of data.products.edges) {
    for (const v of p.node.variants.edges) {
      out.push({
        id: v.node.id,
        sku: v.node.sku,
        title: cleanTitle(v.node.displayName),
        productId: p.node.id,
        imageUrl: v.node.image?.url ?? p.node.featuredImage?.url ?? null,
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
  const clauses: string[] = [];
  for (const t of terms) {
    clauses.push(`title:${t}*`);
    clauses.push(`sku:${t}*`);
  }
  return runProductSearch(shopDomain, accessToken, clauses.join(" OR "));
}
