import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Static landing site. Shares nothing with the Interviewer App in ../src.
export default defineConfig({
  plugins: [tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
});
