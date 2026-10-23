import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Mini Budget — Spend Tracker",
        short_name: "Mini Budget",
        description: "A simple, single-user spend tracker.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#131419",
        theme_color: "#131419",
        categories: ["finance", "productivity"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Right-click the taskbar/dock icon (desktop Chrome/Edge) to jump
        // straight into these — App.jsx reads the matching query param on
        // load and acts on it.
        shortcuts: [
          {
            name: "Add entry",
            short_name: "Add entry",
            description: "Log a new income or expense",
            url: "/?action=add",
            icons: [{ src: "/icon-192.png", sizes: "192x192" }],
          },
          {
            name: "Overview",
            short_name: "Overview",
            description: "Open the balance overview",
            url: "/?tab=dashboard",
            icons: [{ src: "/icon-192.png", sizes: "192x192" }],
          },
        ],
      },
      workbox: {
        // Precache the built app shell (JS/CSS/HTML/icons) so the app opens
        // offline even with zero network — this is what makes "Add to Home
        // Screen" behave like a real app on iOS instead of a dead tab.
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            // Receipt photos: cache what's been viewed so they still open
            // offline; new ones obviously need a network round trip.
            urlPattern: ({ url }) => url.pathname.startsWith("/uploads/"),
            handler: "CacheFirst",
            options: {
              cacheName: "receipt-images",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        // Lets you test install/offline behaviour from `npm run dev` too,
        // not just the production build.
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_PROXY_TARGET || "http://backend:8080",
        changeOrigin: true,
      },
      "/uploads": {
        target: process.env.VITE_PROXY_TARGET || "http://backend:8080",
        changeOrigin: true,
      },
    },
  },
});
