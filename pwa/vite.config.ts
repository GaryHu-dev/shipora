/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command, mode }) => {
  // VITE_API_BASE is inlined at build time. Without it the app calls its own
  // origin, Cloudflare Pages answers POST /api/... with 405, and the failure
  // shows up as "scanning the join QR is broken" — nowhere near the build step
  // that caused it. Refuse to produce that artifact at all.
  if (command === "build" && mode !== "test" && !loadEnv(mode, process.cwd(), "VITE_").VITE_API_BASE) {
    throw new Error(
      "VITE_API_BASE is not set. A production build without it silently ships a " +
        "PWA that cannot reach the backend. Set it in pwa/.env.production."
    );
  }

  return {
    plugins: [
      react(),
      VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "StockProof Warehouse",
        short_name: "StockProof",
        display: "standalone",
        background_color: "#ffffff",
        // Matches the icon's white field, so the splash screen and status bar
        // read as one surface with it. Deliberately NOT the UI's --primary
        // (#2563eb): that blue stays where it is, because it is used as text
        // colour in seven places and the icon's lighter Google blue would drop
        // those below the 4.5:1 contrast floor — in an app used in a warehouse.
        theme_color: "#ffffff",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          // A distinct artwork, not the same file: Android crops maskable
          // icons to the central 80% circle, and the full-bleed carton sits
          // right on that boundary. Pointing both purposes at icon-512.png —
          // as this manifest used to — is what was cropping it on Android.
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      }),
    ],
    test: {
      environment: "jsdom",
      environmentOptions: { jsdom: { url: "http://localhost" } },
      globals: true,
      setupFiles: ["./tests/setup.ts"],
    },
  };
});
