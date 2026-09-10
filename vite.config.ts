import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig(({ mode }) => {
  // loadEnv reads .env, .env.local, .env.<mode> etc. from the project root.
  // The third arg "" means load ALL vars (not just VITE_ prefixed ones).
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          { src: "manifest.json", dest: "." },
          { src: "content/jd-selectors.json", dest: "content" },
          { src: "content/autofill/selectors.json", dest: "content/autofill" },
          { src: "icons/*", dest: "icons" },
          { src: "brand/*", dest: "brand" },
          { src: "handoff/index.html", dest: "handoff" },
          { src: "popup/popup.css", dest: "popup" },
        ],
      }),
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, "popup/index.html"),
          "service-worker": resolve(__dirname, "background/service-worker.ts"),
          // jd-extractor is built separately via vite.content.config.ts as an
          // IIFE so it can be injected by chrome.scripting.executeScript without
          // ES module import failures.
        },
        output: {
          entryFileNames: (chunk) => {
            if (chunk.name === "service-worker") return "background/service-worker.js";
            if (chunk.name === "jd-extractor") return "content/jd-extractor.js";
            return "assets/[name]-[hash].js";
          },
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: (asset) => {
            if (asset.name?.endsWith(".css")) return "popup/popup.css";
            return "assets/[name][extname]";
          },
        },
      },
      // Service workers must not be chunked.
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
