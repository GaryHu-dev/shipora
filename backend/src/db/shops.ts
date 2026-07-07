export interface Shop {
  id: string;
  shop_domain: string;
  access_token: string;
  join_secret: string;
  status: string;
  installed_at: number;
  retention_days: number;
}

export async function createShop(
  db: D1Database,
  s: { id: string; shopDomain: string; accessToken: string; joinSecret: string; installedAt: number }
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO shops (id, shop_domain, access_token, join_secret, status, installed_at) VALUES (?,?,?,?, 'active', ?)"
    )
    .bind(s.id, s.shopDomain, s.accessToken, s.joinSecret, s.installedAt)
    .run();
}

export async function getShopById(db: D1Database, id: string): Promise<Shop | null> {
  return await db.prepare("SELECT * FROM shops WHERE id = ?").bind(id).first<Shop>();
}

export async function setRetentionDays(db: D1Database, id: string, days: number): Promise<void> {
  await db.prepare("UPDATE shops SET retention_days = ? WHERE id = ?").bind(days, id).run();
}

// Rotating the join_secret invalidates every outstanding join link for this shop.
export async function setJoinSecret(db: D1Database, id: string, secret: string): Promise<void> {
  await db.prepare("UPDATE shops SET join_secret = ? WHERE id = ?").bind(secret, id).run();
}
