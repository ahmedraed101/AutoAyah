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
        globIgnores: ["**/fonts/**"],
      },
      manifest: {
        name: "AutoAyah",
        short_name: "AutoAyah",
        description: "Quran video editor for creators",
        theme_color: "#0b0f0c",
        background_color: "#0b0f0c",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
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
