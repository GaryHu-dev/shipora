/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Shipora",
        short_name: "Shipora",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#111111",
        icons: [],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost" } },
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
