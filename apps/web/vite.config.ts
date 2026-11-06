import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const hub = process.env.HUB_URL ?? "http://127.0.0.1:8787";
const relay = process.env.RELAY_URL ?? "http://127.0.0.1:8402";
const merchantApi = process.env.MERCHANT_URL ?? "http://127.0.0.1:8403";

// The console's own origin, for the absolute link-preview URLs in index.html (%VITE_PUBLIC_ORIGIN%). A deploy
// to the custom domain sets it; without one it is the Railway host that serves production today.
process.env.VITE_PUBLIC_ORIGIN ??= "https://web-production-a58de.up.railway.app";

const strip = (prefix: string) => (path: string) => path.replace(new RegExp(`^${prefix}`), "");

/** Same-origin paths for every backend the pages call, so one tunnel to this port reaches all of them. */
const proxy = {
  "/hub": { target: hub, changeOrigin: true, rewrite: strip("/hub") },
  "/relay": { target: relay, changeOrigin: true, rewrite: strip("/relay") },
  "/merchant-api": { target: merchantApi, changeOrigin: true, rewrite: strip("/merchant-api") },
};

export default defineConfig({
  // Relative asset paths plus hash routing: the build runs from any host or folder.
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5191,
    strictPort: true,
    proxy,
  },
  // The built app gets the same proxies.
  preview: { host: "127.0.0.1", port: 4173, proxy },
  // One bundle on purpose (see app/routes.ts), so its size is expected.
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 900 },
});
