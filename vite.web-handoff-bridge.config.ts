import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "content/web-handoff-bridge.ts"),
      name: "FlintWebHandoffBridge",
      formats: ["iife"],
      fileName: () => "content/web-handoff-bridge.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    target: "esnext",
  },
});
