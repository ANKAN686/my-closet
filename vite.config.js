import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "ui",
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, "ui/index.html"),
        dashboard: resolve(__dirname, "ui/dashboard.html"),
        items: resolve(__dirname, "ui/items.html"),
        outfits: resolve(__dirname, "ui/outfits.html"),
        wearLogs: resolve(__dirname, "ui/wear-logs.html"),
      },
    },
  },
});
