import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The shared @screenxshot/editor package is consumed as source (JSX).
  // Exclude it from pre-bundling so Vite/esbuild transforms its JSX via the
  // React plugin instead of treating it as an opaque dependency.
  optimizeDeps: {
    exclude: ["@screenxshot/editor"],
  },
});
