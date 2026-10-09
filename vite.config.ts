import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Ollama and whisper.cpp are reached through the dev server so the browser never
// needs CORS changes and the app only ever talks to its own origin (see CSP).
const proxy = {
  "/ollama": {
    target: "http://127.0.0.1:11434",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/ollama/, ""),
  },
  "/whisper": {
    target: "http://127.0.0.1:8178",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/whisper/, ""),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy },
  preview: { proxy },
  test: { environment: "node" },
});
