import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "content/flint-click-guard.ts"),
      name: "FlintClickGuard",
      formats: ["iife"],
      fileName: () => "content/flint-click-guard.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    target: "esnext",
  },
});
