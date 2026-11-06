import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = `http://localhost:${process.env.PORT ?? 3737}`;

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/web" },
  server: {
    proxy: { "/api": api, "/out": api },
  },
});
