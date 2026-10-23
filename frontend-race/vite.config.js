import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Same setup as ../frontend, different identity. Both apps talk to the same
// backend through nginx (/api, /uploads); only the manifest differs.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Race Budget — Race Cost Planner",
        short_name: "Race Budget",
        description: "Plan and track what your races cost. Companion to Mini Budget.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#131419",
        theme_color: "#131419",
        categories: ["finance", "sports"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          {
            name: "Add cost",
            short_name: "Add cost",
            description: "Log a new race cost",
            url: "/?action=add",
            icons: [{ src: "/icon-192.png", sizes: "192x192" }],
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        navigateFallback: "/index.html",
      },
      devOptions: { enabled: true, type: "module" },
    }),
  ],
  server: {
    host: true,
    port: 5174,
    proxy: {
      "/api": { target: process.env.VITE_PROXY_TARGET || "http://backend:8080", changeOrigin: true },
    },
  },
});
