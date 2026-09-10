/**
 * Separate Vite build for the content script.
 *
 * Content scripts injected via chrome.scripting.executeScript are loaded as
 * classic scripts, not ES modules. If the bundle contains top-level `import`
 * statements they fail silently and the message listener is never registered.
 *
 * Building the content script as an IIFE with inlineDynamicImports ensures
 * the output file is fully self-contained with zero external chunk references.
 */
import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    build: {
      outDir: "dist",
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, "content/jd-extractor.ts"),
        name: "JdExtractor",
        formats: ["iife"],
        fileName: () => "content/jd-extractor.js",
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
      target: "esnext",
    },
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(
        env.VITE_API_BASE_URL ?? "http://localhost:8000",
      ),
      "import.meta.env.VITE_WEB_APP_BASE_URL": JSON.stringify(
        env.VITE_WEB_APP_BASE_URL ?? "http://localhost:3100",
      ),
      "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(
        env.VITE_GOOGLE_CLIENT_ID ?? "",
      ),
    },
  };
});
