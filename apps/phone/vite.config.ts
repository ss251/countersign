import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const hub = process.env.HUB_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  // Served by the console under /phone/. Relative asset paths keep the build portable.
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5193,
    strictPort: true,
    // ?hub=/hub reaches a local hub through this one port, WebSocket included.
    proxy: {
      "/hub": { target: hub, changeOrigin: true, ws: true, rewrite: (path) => path.replace(/^\/hub/, "") },
    },
  },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
