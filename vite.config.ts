import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Ollama is reached through the dev server so the browser never needs CORS
// changes and the app only ever talks to localhost.
const ollama = {
  "/ollama": {
    target: "http://127.0.0.1:11434",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/ollama/, ""),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: ollama },
  preview: { proxy: ollama },
  test: { environment: "node" },
});
