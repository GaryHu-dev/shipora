import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  InlineStack,
  Text,
  Link,
  Badge,
  Divider,
} from "@shopify/ui-extensions-react/admin";
import { useEffect, useState } from "react";

const TARGET = "admin.order-details.block.render";
// Hardcoded because a Shopify UI extension has no access to the Worker's vars —
// it is bundled and served by Shopify, not by us. That makes this line a
// migration hazard: it does not move when APP_URL does, and nothing fails at
// build time if it goes stale. It was left pointing at a decommissioned Worker
// once already. If the backend host changes, change it HERE and redeploy the
// extension (`shopify app deploy`), not just wrangler.jsonc.
const BACKEND = "https://stockproof-backend.dms-259.workers.dev";
const CAT = {
  shipping_photo: "Shipping photo",
  packing_slip: "Packing slip",
  shipping_label: "Shipping label",
  damage: "Damage / issue",
  document: "Document",
  other: "Other",
};
const TONE = {
  shipping_photo: "info",
  damage: "critical",
  packing_slip: "attention",
  shipping_label: "attention",
};

function ago(ts) {
  return new Date(ts * 1000).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default reactExtension(TARGET, () => <OrderPhotos />);

function OrderPhotos() {
  const { data } = useApi(TARGET);
  const orderGid = data?.selected?.[0]?.id;
  const [photos, setPhotos] = useState(null);

  useEffect(() => {
    if (!orderGid) return;
    (async () => {
      try {
        const res = await fetch(BACKEND + "/admin/api/order-photos?gid=" + encodeURIComponent(orderGid));
        const j = await res.json();
        setPhotos(j.photos || []);
      } catch (e) {
        setPhotos([]);
      }
    })();
  }, [orderGid]);

  return (
    <AdminBlock title="StockProof">
      {photos === null ? (
        <Text>Loading…</Text>
      ) : photos.length === 0 ? (
        <Text subdued>No shipping photos uploaded yet.</Text>
      ) : (
        <BlockStack gap="base">
          <Text fontWeight="bold">
            {photos.length} photo{photos.length > 1 ? "s" : ""} · proof of shipment
          </Text>
          <Divider />
          {photos.map((p, i) => (
            <BlockStack key={p.id} gap="base">
              <InlineStack gap="base" inlineAlignment="space-between" blockAlignment="center">
                <InlineStack gap="base" blockAlignment="center">
                  <Text fontWeight="bold" subdued>#{i + 1}</Text>
                  <Badge tone={TONE[p.category]}>{CAT[p.category] || p.category}</Badge>
                </InlineStack>
                <Link to={p.url} target="_blank">View</Link>
              </InlineStack>
              <Text subdued>by {p.uploaded_by_name} · {ago(p.uploaded_at)}</Text>
              {i < photos.length - 1 ? <Divider /> : null}
            </BlockStack>
          ))}
        </BlockStack>
      )}
    </AdminBlock>
  );
}
