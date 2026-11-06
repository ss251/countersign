import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const hub = process.env.HUB_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  // Relative asset paths plus hash routing: the build runs from any host or folder.
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // In development the hub is reached through /hub, so the page and the API share an origin.
    proxy: {
      "/hub": { target: hub, changeOrigin: true, rewrite: (path) => path.replace(/^\/hub/, "") },
    },
  },
  preview: { host: "127.0.0.1", port: 4173 },
  build: { target: "es2022", sourcemap: true },
});
