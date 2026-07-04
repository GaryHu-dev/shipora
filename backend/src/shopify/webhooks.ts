import type { Env } from "../types";
import { shopifyGraphQL } from "./graphql";

const SUBSCRIBE = `
mutation Subscribe($topic: WebhookSubscriptionTopic!, $url: URL!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
    userErrors { field message }
  }
}`;

const TOPICS: { topic: string; path: string }[] = [
  { topic: "ORDERS_CREATE", path: "orders/create" },
  { topic: "ORDERS_UPDATED", path: "orders/updated" },
  { topic: "APP_UNINSTALLED", path: "app/uninstalled" },
];

export async function registerWebhooks(
  env: Env,
  shop: { shop_domain: string; access_token: string }
): Promise<void> {
  for (const { topic, path } of TOPICS) {
    try {
      await shopifyGraphQL(shop.shop_domain, shop.access_token, SUBSCRIBE, {
        topic,
        url: `${env.APP_URL}/webhooks/${path}`,
      });
    } catch {
      // best-effort: a duplicate subscription or transient error must not block install
    }
  }
}
