import type { Env } from "../types";
import { shopifyGraphQL } from "./graphql";

const LIST = `
query Subscriptions {
  webhookSubscriptions(first: 50) {
    edges {
      node {
        id
        topic
        endpoint { ... on WebhookHttpEndpoint { callbackUrl } }
      }
    }
  }
}`;

const CREATE = `
mutation Subscribe($topic: WebhookSubscriptionTopic!, $url: URL!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
    userErrors { field message }
  }
}`;

const UPDATE = `
mutation Repoint($id: ID!, $url: URL!) {
  webhookSubscriptionUpdate(id: $id, webhookSubscription: { callbackUrl: $url }) {
    userErrors { field message }
  }
}`;

const TOPICS: { topic: string; path: string }[] = [
  { topic: "ORDERS_CREATE", path: "orders/create" },
  { topic: "ORDERS_UPDATED", path: "orders/updated" },
  { topic: "APP_UNINSTALLED", path: "app/uninstalled" },
];

interface ListResult {
  webhookSubscriptions: {
    edges: { node: { id: string; topic: string; endpoint: { callbackUrl?: string } | null } }[];
  };
}

export interface WebhookSync {
  created: string[];
  repointed: string[];
  unchanged: string[];
  failed: { topic: string; reason: string }[];
}

/**
 * Bring the shop's webhook subscriptions in line with this deployment's
 * APP_URL, whatever state they are in.
 *
 * This used to call webhookSubscriptionCreate for each topic and swallow every
 * error, which made it a no-op in the one case that matters. Shopify rejects a
 * create when the topic already has a subscription, so once a subscription
 * existed at a stale URL — after the Cloudflare account move, for instance —
 * reinstalling the app could not repair it: the create failed, the failure was
 * discarded, and the subscription kept pointing at a Worker that no longer
 * answers. Orders stopped arriving for five days and nothing anywhere said so.
 *
 * So: read what exists, repoint what is wrong, create what is missing, and
 * report the outcome instead of discarding it. Still non-throwing — a webhook
 * problem must not block an install — but the caller can now see what happened.
 */
export async function registerWebhooks(
  env: Env,
  shop: { shop_domain: string; access_token: string }
): Promise<WebhookSync> {
  const out: WebhookSync = { created: [], repointed: [], unchanged: [], failed: [] };

  let existing: ListResult["webhookSubscriptions"]["edges"] = [];
  try {
    const data = await shopifyGraphQL<ListResult>(shop.shop_domain, shop.access_token, LIST, {});
    existing = data.webhookSubscriptions.edges;
  } catch (e) {
    // Without the list we cannot tell "missing" from "pointing elsewhere", and
    // guessing wrong is what caused the outage. Report rather than proceed.
    const reason = e instanceof Error ? e.message : "could not list subscriptions";
    return { ...out, failed: TOPICS.map((t) => ({ topic: t.topic, reason })) };
  }

  for (const { topic, path } of TOPICS) {
    const want = `${env.APP_URL}/webhooks/${path}`;
    const found = existing.find((e) => e.node.topic === topic);
    try {
      if (!found) {
        await shopifyGraphQL(shop.shop_domain, shop.access_token, CREATE, { topic, url: want });
        out.created.push(topic);
      } else if (found.node.endpoint?.callbackUrl !== want) {
        await shopifyGraphQL(shop.shop_domain, shop.access_token, UPDATE, { id: found.node.id, url: want });
        out.repointed.push(topic);
      } else {
        out.unchanged.push(topic);
      }
    } catch (e) {
      out.failed.push({ topic, reason: e instanceof Error ? e.message : "unknown error" });
    }
  }
  return out;
}
