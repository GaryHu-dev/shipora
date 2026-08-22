import { env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { SHOPIFY_API_VERSION } from "../src/shopify/graphql";
import { registerWebhooks } from "../src/shopify/webhooks";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const SHOP = { shop_domain: "demo.myshopify.com", access_token: "tok" };
const APP = "https://stockproof-backend.example.workers.dev";

function mockGraphQL(response: unknown, captured?: { bodies: string[] }) {
  fetchMock
    .get("https://demo.myshopify.com")
    .intercept({
      path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      method: "POST",
      body: (b: string) => { captured?.bodies.push(b); return true; },
    })
    .reply(200, JSON.stringify(response));
}

function list(...subs: { topic: string; url: string }[]) {
  return {
    data: {
      webhookSubscriptions: {
        edges: subs.map((s, i) => ({
          node: { id: `gid://shopify/WebhookSubscription/${i + 1}`, topic: s.topic, endpoint: { callbackUrl: s.url } },
        })),
      },
    },
  };
}
const ok = { data: { webhookSubscriptionCreate: { userErrors: [] } } };
const okUpd = { data: { webhookSubscriptionUpdate: { userErrors: [] } } };

describe("registerWebhooks", () => {
  it("creates the three subscriptions on a fresh install", async () => {
    mockGraphQL(list());
    mockGraphQL(ok); mockGraphQL(ok); mockGraphQL(ok);

    const r = await registerWebhooks({ ...env, APP_URL: APP } as never, SHOP);
    expect(r.created).toEqual(["ORDERS_CREATE", "ORDERS_UPDATED", "APP_UNINSTALLED"]);
    expect(r.repointed).toEqual([]);
  });

  it("repoints a subscription that still points at an old deployment", async () => {
    // The case the previous implementation could not fix: Shopify rejects a
    // create when the topic already has a subscription, so blindly creating
    // and discarding the error left the stale URL in place — which is exactly
    // how orders stopped arriving after the Cloudflare account move.
    const captured = { bodies: [] as string[] };
    mockGraphQL(list(
      { topic: "ORDERS_CREATE", url: "https://old-worker.example.workers.dev/webhooks/orders/create" },
      { topic: "ORDERS_UPDATED", url: `${APP}/webhooks/orders/updated` },
      { topic: "APP_UNINSTALLED", url: `${APP}/webhooks/app/uninstalled` },
    ), captured);
    mockGraphQL(okUpd, captured);

    const r = await registerWebhooks({ ...env, APP_URL: APP } as never, SHOP);
    expect(r.repointed).toEqual(["ORDERS_CREATE"]);
    expect(r.unchanged).toEqual(["ORDERS_UPDATED", "APP_UNINSTALLED"]);
    expect(r.created).toEqual([]);

    // Find the mutation among the captured requests rather than assuming an
    // index — the assertion is about what was sent, not about call ordering.
    const upd = captured.bodies.map((b) => JSON.parse(b)).find((b) => b.query.includes("webhookSubscriptionUpdate"));
    expect(upd).toBeDefined();
    expect(upd.variables.url).toBe(`${APP}/webhooks/orders/create`);
    expect(upd.variables.id).toBe("gid://shopify/WebhookSubscription/1");
  });

  it("touches nothing when all three already point here", async () => {
    mockGraphQL(list(
      { topic: "ORDERS_CREATE", url: `${APP}/webhooks/orders/create` },
      { topic: "ORDERS_UPDATED", url: `${APP}/webhooks/orders/updated` },
      { topic: "APP_UNINSTALLED", url: `${APP}/webhooks/app/uninstalled` },
    ));

    const r = await registerWebhooks({ ...env, APP_URL: APP } as never, SHOP);
    expect(r.unchanged).toHaveLength(3);
    expect([...r.created, ...r.repointed, ...r.failed]).toEqual([]);
  });

  it("reports failures instead of discarding them, and still does not throw", async () => {
    mockGraphQL(list());
    fetchMock.get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(500, "boom");
    mockGraphQL(ok); mockGraphQL(ok);

    const r = await registerWebhooks({ ...env, APP_URL: APP } as never, SHOP);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].topic).toBe("ORDERS_CREATE");
    expect(r.created).toEqual(["ORDERS_UPDATED", "APP_UNINSTALLED"]);
  });

  it("does not guess when it cannot read the existing subscriptions", async () => {
    // Guessing is what the old code did, and it guessed wrong in the only case
    // that mattered. Without the list, "missing" and "pointing elsewhere" are
    // indistinguishable, so report all three as failed rather than create.
    fetchMock.get("https://demo.myshopify.com")
      .intercept({ path: `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, method: "POST" })
      .reply(500, "boom");

    const r = await registerWebhooks({ ...env, APP_URL: APP } as never, SHOP);
    expect(r.failed).toHaveLength(3);
    expect([...r.created, ...r.repointed]).toEqual([]);
  });
});
