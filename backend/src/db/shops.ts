export interface Shop {
  id: string;
  shop_domain: string;
  access_token: string;
  join_secret: string;
  status: string;
  installed_at: number;
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
