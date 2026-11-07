import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const api = `http://localhost:${process.env.PORT ?? 3737}`;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        navigateFallbackDenylist: [/^\/(api|out|uploads|media|ambience|mcp|openapi\.json)/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        globIgnores: ["**/fonts/**"],
      },
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "icon.svg", "logo.png"],
      manifest: {
        name: "AutoAyah",
        short_name: "AutoAyah",
        description: "محرر فيديو القرآن للمبدعين",
        lang: "ar",
        dir: "rtl",
        theme_color: "#121e2d",
        background_color: "#121e2d",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": api,
      "/out": api,
      "/uploads": api,
      "/ambience": api,
      "/fonts": api,
      "/media": api,
      "/mcp": api,
      "/openapi.json": api,
    },
  },
  build: { outDir: "dist" },
});
