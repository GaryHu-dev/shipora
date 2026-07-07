export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  PHOTO_RL?: RateLimit;
  APP_SECRET: string;
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_SCOPES: string;
  APP_URL: string;
  PWA_URL: string;
  ADMIN_KEY: string;
}
