import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const migrations = await readD1Migrations("./migrations");

export default defineWorkersConfig({
  test: {
    setupFiles: ["./tests/apply-migrations.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Test-only secret values (not real). Secrets live outside the
          // committed wrangler.jsonc; tests inject deterministic fakes here.
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_SECRET: "test-app-secret",
            SHOPIFY_API_SECRET: "test-api-secret",
            SHOPIFY_API_KEY: "test-api-key",
            ADMIN_KEY: "test-admin-key",
          },
        },
      },
    },
  },
});
