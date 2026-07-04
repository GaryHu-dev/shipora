import { shopifyGraphQL } from "./graphql";

const TAGS_ADD = `
mutation AddTags($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node { id }
    userErrors { field message }
  }
}`;

interface TagsAddResult {
  tagsAdd: { node: { id: string } | null; userErrors: { field: string[] | string | null; message: string }[] };
}

export async function addOrderTag(
  shopDomain: string,
  accessToken: string,
  orderGid: string,
  tag: string
): Promise<void> {
  const data = await shopifyGraphQL<TagsAddResult>(shopDomain, accessToken, TAGS_ADD, { id: orderGid, tags: [tag] });
  const errs = data.tagsAdd.userErrors;
  if (errs.length > 0) {
    throw new Error(`tagsAdd userErrors: ${errs.map((e) => e.message).join("; ")}`);
  }
}
