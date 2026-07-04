export interface User {
  id: string;
  shop_id: string;
  name: string;
  email: string | null;
  joined_at: number;
}

export async function createUser(
  db: D1Database,
  u: { id: string; shopId: string; name: string; joinedAt: number }
): Promise<void> {
  await db
    .prepare("INSERT INTO users (id, shop_id, name, joined_at) VALUES (?,?,?,?)")
    .bind(u.id, u.shopId, u.name, u.joinedAt)
    .run();
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  return await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();
}
