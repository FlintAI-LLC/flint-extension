import { defineConfig } from "vite";
import { resolve } from "path";

/** MAIN-world network hook for my.greenhouse.io (classic IIFE, no imports). */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "content/my-greenhouse-network.ts"),
      name: "MyGreenhouseNetwork",
      formats: ["iife"],
      fileName: () => "content/my-greenhouse-network.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    target: "esnext",
  },
});
