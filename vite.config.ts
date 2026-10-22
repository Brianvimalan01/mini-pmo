/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Relative base + hash routing lets the same build run on GitHub Pages
// (served from /<repo>/) or any other static host.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  // Charts make the main bundle ~900 kB; fine for a single-user app that the
  // service worker caches after the first load.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
  },
});
