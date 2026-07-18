import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Tauri expects a fixed dev port and no clearing of the screen.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
  },
  // Consume the shared editor package as source (JSX) rather than pre-bundling.
  optimizeDeps: {
    exclude: ["@screenxshot/editor"],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        overlay: resolve(__dirname, "overlay.html"),
        settings: resolve(__dirname, "settings.html"),
        toast: resolve(__dirname, "toast.html"),
        pin: resolve(__dirname, "pin.html"),
        scroll: resolve(__dirname, "scroll.html"),
      },
    },
  },
});
